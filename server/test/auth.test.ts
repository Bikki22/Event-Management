import type { Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import { signAccessToken, verifyAccessToken } from "../src/modules/auth/tokens.js";
import {
  processEmail,
  type EmailJobData,
} from "../src/modules/notifications/notifications.jobs.js";
import {
  api,
  latestEmailToken,
  login,
  me,
  PASSWORD,
  refresh,
  refreshCookie,
  register,
  resetState,
} from "./helpers.js";

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

describe("register", () => {
  it("creates the user, logs them in and queues a verification email", async () => {
    const { res, cookie } = await register("Alice@Example.com");
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe("/api/v1/me");
    expect(res.body.user).toMatchObject({
      email: "alice@example.com",
      role: "attendee",
      emailVerified: false,
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.expiresIn).toBe(900);
    expect(cookie).toMatch(/^ems_rt=.+/);

    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/api/v1/auth");

    const n = await prisma.notification.findFirstOrThrow();
    expect(n).toMatchObject({ type: "auth.verify_email", status: "queued" });
  });

  it("stores only hashes of tokens and an argon2id password hash", async () => {
    const { cookie } = await register();
    const user = await prisma.user.findFirstOrThrow();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const rt = await prisma.refreshToken.findFirstOrThrow();
    expect(rt.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie).not.toContain(rt.tokenHash);
  });

  it("rejects a duplicate email case-insensitively", async () => {
    await register("alice@example.com");
    const { res } = await register("ALICE@example.com");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("rejects unknown fields (no mass assignment) and weak input", async () => {
    const res = await api()
      .post("/api/v1/auth/register")
      .send({ email: "x@example.com", password: PASSWORD, fullName: "X", role: "admin" });
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");

    const short = await api()
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "short", fullName: "" });
    expect(short.status).toBe(400);
    expect(short.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(
      ["email", "fullName", "password"].sort(),
    );
  });
});

describe("login", () => {
  it("returns tokens for valid credentials", async () => {
    await register();
    const { res, cookie } = await login("ALICE@example.com");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("alice@example.com");
    expect(cookie).toMatch(/^ems_rt=/);
    expect((await me(res.body.accessToken)).status).toBe(200);
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    await register();
    const wrong = await login("alice@example.com", "wrong password");
    const unknown = await login("ghost@example.com", "wrong password");
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.res.body.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.res.body.code).toBe("INVALID_CREDENTIALS");
    expect(wrong.res.body.title).toBe(unknown.res.body.title);
  });

  it("reveals suspension only after the correct password, and blocks existing tokens", async () => {
    const { accessToken } = await register();
    await prisma.user.updateMany({ data: { status: "suspended" } });
    await redis.flushdb(); // drop the cached user state (normally done by the admin action)

    expect((await login("alice@example.com", "wrong password")).res.body.code).toBe(
      "INVALID_CREDENTIALS",
    );
    expect((await login()).res.body.code).toBe("ACCOUNT_SUSPENDED");
    const res = await me(accessToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("is rate limited per IP (5/min)", async () => {
    await register();
    for (let i = 0; i < 5; i++) await login("alice@example.com", "wrong password");
    const { res } = await login();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBeDefined();
  });
});

describe("access token + authenticate", () => {
  it("requires a bearer token", async () => {
    const res = await api().get("/api/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("rejects tampered and foreign tokens", async () => {
    const { accessToken } = await register();
    const [h, p, s] = accessToken.split(".");
    const tampered = `${h}.${p}.${s!.slice(0, -2)}xx`;
    expect((await me(tampered)).body.code).toBe("TOKEN_INVALID");
    expect((await me("not.a.jwt")).body.code).toBe("TOKEN_INVALID");
  });

  it("signs EdDSA tokens with the expected claims", async () => {
    const { accessToken } = await register();
    const header = JSON.parse(Buffer.from(accessToken.split(".")[0]!, "base64url").toString());
    expect(header).toMatchObject({ alg: "EdDSA", kid: "test" });
    const claims = await verifyAccessToken(accessToken);
    const session = await prisma.authSession.findFirstOrThrow();
    expect(claims.sessionId).toBe(session.id);
  });

  it("rejects an access token for a session revoked in Redis", async () => {
    const user = await register();
    const session = await prisma.authSession.findFirstOrThrow();
    const token = await signAccessToken({
      userId: user.res.body.user.id,
      role: "attendee",
      sessionId: session.id,
    });
    await api().post("/api/v1/auth/logout").set("Authorization", `Bearer ${token}`).expect(204);
    expect((await me(token)).body.code).toBe("SESSION_REVOKED");
  });
});

describe("refresh", () => {
  it("rotates the refresh token and issues a new access token", async () => {
    const { cookie } = await register();
    const res = await refresh(cookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const next = refreshCookie(res);
    expect(next).toMatch(/^ems_rt=/);
    expect(next).not.toBe(cookie);
    expect((await refresh(next)).status).toBe(200);
  });

  it("requires the CSRF header and an allowed Origin", async () => {
    const { cookie } = await register();
    const noHeader = await api().post("/api/v1/auth/refresh").set("Cookie", cookie);
    expect(noHeader.body.code).toBe("CSRF_CHECK_FAILED");
    const badOrigin = await api()
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .set("X-Requested-With", "fetch")
      .set("Origin", "https://evil.example");
    expect(badOrigin.body.code).toBe("CSRF_CHECK_FAILED");
  });

  it("returns REFRESH_INVALID (no revoke) for a token reused within the 10 s grace window", async () => {
    const { cookie } = await register();
    const first = await refresh(cookie);
    const again = await refresh(cookie); // e.g. second browser tab
    expect(again.status).toBe(401);
    expect(again.body.code).toBe("REFRESH_INVALID");
    expect((await refresh(refreshCookie(first))).status).toBe(200); // session still alive
  });

  it("revokes the whole session when an old refresh token is replayed (theft)", async () => {
    const { cookie: stolen, accessToken } = await register();
    const legit = await refresh(stolen);
    await prisma.$executeRaw`UPDATE refresh_tokens SET used_at = now() - interval '1 minute' WHERE used_at IS NOT NULL`;

    const attack = await refresh(stolen);
    expect(attack.status).toBe(401);
    expect(attack.body.code).toBe("REFRESH_REUSED");

    // both the attacker and the real user must sign in again
    expect((await refresh(refreshCookie(legit))).body.code).toBe("REFRESH_INVALID");
    expect((await me(legit.body.accessToken)).body.code).toBe("SESSION_REVOKED");
    expect((await me(accessToken)).body.code).toBe("SESSION_REVOKED");
    const s = await prisma.authSession.findFirstOrThrow();
    expect(s.revokeReason).toBe("reuse_detected");
  });

  it("rejects expired, missing and garbage refresh tokens and clears the cookie", async () => {
    const { cookie } = await register();
    // simulate time passing (shift both columns so the expires_at > created_at CHECK holds)
    await prisma.$executeRaw`UPDATE refresh_tokens SET created_at = now() - interval '31 days', expires_at = now() - interval '1 second'`;
    const expired = await refresh(cookie);
    expect(expired.body.code).toBe("REFRESH_INVALID");
    expect(String(expired.headers["set-cookie"])).toMatch(/ems_rt=;/);

    expect((await refresh("")).body.code).toBe("REFRESH_INVALID");
    expect((await refresh("ems_rt=garbage")).body.code).toBe("REFRESH_INVALID");
  });
});

describe("logout and sessions", () => {
  it("logout revokes the session immediately and clears the cookie", async () => {
    const { accessToken, cookie } = await register();
    const res = await api()
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/ems_rt=;/);
    expect((await me(accessToken)).body.code).toBe("SESSION_REVOKED");
    expect((await refresh(cookie)).body.code).toBe("REFRESH_INVALID");
  });

  it("lists active sessions and revokes another device", async () => {
    await register();
    const a = await login();
    const b = await login();
    const list = await api()
      .get("/api/v1/auth/sessions")
      .set("Authorization", `Bearer ${a.accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const bSid = (await verifyAccessToken(b.accessToken)).sessionId;
    await api()
      .delete(`/api/v1/auth/sessions/${bSid}`)
      .set("Authorization", `Bearer ${a.accessToken}`)
      .expect(204);
    expect((await me(b.accessToken)).body.code).toBe("SESSION_REVOKED");
    expect((await me(a.accessToken)).status).toBe(200);
  });

  it("can't revoke someone else's session (404, no existence leak)", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const bobSid = (await verifyAccessToken(bob.accessToken)).sessionId;
    const res = await api()
      .delete(`/api/v1/auth/sessions/${bobSid}`)
      .set("Authorization", `Bearer ${alice.accessToken}`);
    expect(res.status).toBe(404);
    expect((await me(bob.accessToken)).status).toBe(200);
  });
});

describe("email verification", () => {
  it("verifies once; the link can't be reused", async () => {
    const { accessToken } = await register();
    const token = await latestEmailToken("auth.verify_email");

    const ok = await api().post("/api/v1/auth/verify-email").send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.user.emailVerified).toBe(true);
    expect((await me(accessToken)).body.user.emailVerified).toBe(true);

    const reuse = await api().post("/api/v1/auth/verify-email").send({ token });
    expect(reuse.body.code).toBe("INVALID_OR_EXPIRED_TOKEN");
  });

  it("rejects expired links", async () => {
    await register();
    const token = await latestEmailToken("auth.verify_email");
    await prisma.$executeRaw`UPDATE verification_tokens SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 second'`;
    const res = await api().post("/api/v1/auth/verify-email").send({ token });
    expect(res.body.code).toBe("INVALID_OR_EXPIRED_TOKEN");
  });

  it("resend issues a new link and invalidates the old one", async () => {
    const { accessToken } = await register();
    const old = await latestEmailToken("auth.verify_email");
    await api()
      .post("/api/v1/auth/resend-verification")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(202);
    const fresh = await latestEmailToken("auth.verify_email");
    expect(fresh).not.toBe(old);
    expect((await api().post("/api/v1/auth/verify-email").send({ token: old })).status).toBe(400);
    expect((await api().post("/api/v1/auth/verify-email").send({ token: fresh })).status).toBe(200);

    const again = await api()
      .post("/api/v1/auth/resend-verification")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(again.body.code).toBe("ALREADY_VERIFIED");
  });
});

describe("forgot / reset / change password", () => {
  const forgot = (email: string) => api().post("/api/v1/auth/forgot-password").send({ email });
  const waitForEmail = async (type: string, count: number) => {
    for (let i = 0; i < 50; i++) {
      if ((await prisma.notification.count({ where: { type } })) >= count) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no ${type} email queued`);
  };

  it("answers 202 with an identical body for known and unknown emails", async () => {
    await register();
    const known = await forgot("alice@example.com");
    const unknown = await forgot("ghost@example.com");
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.text).toBe(unknown.text);
    await waitForEmail("auth.password_reset", 1);
    expect(await prisma.notification.count({ where: { type: "auth.password_reset" } })).toBe(1);
  });

  it("reset changes the password, revokes all sessions, works once, and emails the user", async () => {
    const { accessToken } = await register();
    await forgot("alice@example.com");
    await waitForEmail("auth.password_reset", 1);
    const token = await latestEmailToken("auth.password_reset");

    const res = await api()
      .post("/api/v1/auth/reset-password")
      .send({ token, newPassword: "brand new password" });
    expect(res.status).toBe(204);
    expect((await me(accessToken)).body.code).toBe("SESSION_REVOKED");
    expect((await login()).res.status).toBe(401);
    expect((await login("alice@example.com", "brand new password")).res.status).toBe(200);

    const reuse = await api()
      .post("/api/v1/auth/reset-password")
      .send({ token, newPassword: "another password" });
    expect(reuse.body.code).toBe("INVALID_OR_EXPIRED_TOKEN");

    const user = await prisma.user.findFirstOrThrow();
    expect(user.emailVerifiedAt).not.toBeNull(); // proved inbox ownership
    expect(await prisma.notification.count({ where: { type: "auth.password_changed" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "auth.password_reset" } })).toBe(1);
  });

  it("change-password needs the current password and keeps only this device signed in", async () => {
    const { accessToken: current } = await register();
    const other = await login();

    const wrong = await api()
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${current}`)
      .send({ currentPassword: "nope", newPassword: "brand new password" });
    expect(wrong.body.code).toBe("INVALID_CREDENTIALS");

    await api()
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${current}`)
      .send({ currentPassword: PASSWORD, newPassword: "brand new password" })
      .expect(204);
    expect((await me(current)).status).toBe(200);
    expect((await me(other.accessToken)).body.code).toBe("SESSION_REVOKED");
    expect((await login("alice@example.com", "brand new password")).res.status).toBe(200);
  });
});

describe("email worker", () => {
  const job = (notificationId: string) =>
    ({ data: { notificationId }, attemptsMade: 0, opts: { attempts: 8 } }) as Job<EmailJobData>;

  it("sends once, marks the row sent and scrubs the one-time token", async () => {
    await register();
    const n = await prisma.notification.findFirstOrThrow();
    await processEmail(job(n.id));
    await processEmail(job(n.id)); // a retry/duplicate is a no-op

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.status).toBe("sent");
    expect(after.attempts).toBe(1);
    expect(after.sentAt).not.toBeNull();
    expect((after.payload as { token: unknown }).token).toBeNull();
  });
});
