import request from "supertest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";

export const app = buildApp();
export const api = () => request(app);

/** Wipes all auth data and Redis (rate limits, revoked sessions, queues) between tests. */
export async function resetState(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE ticket_types, events, venues, uploads, categories, organizer_profiles, users, auth_sessions, refresh_tokens, verification_tokens, notifications, audit_logs RESTART IDENTITY CASCADE`;
  await redis.flushdb();
}

export const PASSWORD = "correct horse battery";

export async function register(email = "alice@example.com", password = PASSWORD) {
  const res = await api()
    .post("/api/v1/auth/register")
    .send({ email, password, fullName: "Alice Test" });
  return { res, accessToken: res.body.accessToken as string, cookie: refreshCookie(res) };
}

export async function login(email = "alice@example.com", password = PASSWORD) {
  const res = await api().post("/api/v1/auth/login").send({ email, password });
  return { res, accessToken: res.body.accessToken as string, cookie: refreshCookie(res) };
}

/** "ems_rt=<value>" from a response's Set-Cookie header (or "" when cleared/absent). */
export function refreshCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const c = raw?.find((h) => h.startsWith("ems_rt="));
  const pair = c?.split(";")[0] ?? "";
  return pair === "ems_rt=" ? "" : pair;
}

export const refresh = (cookie: string) =>
  api()
    .post("/api/v1/auth/refresh")
    .set("Cookie", cookie)
    .set("X-Requested-With", "fetch")
    .set("Origin", "http://localhost:5173");

/** Reads the one-time token from the newest queued email of a type (the worker isn't running in tests). */
export async function latestEmailToken(type: string): Promise<string> {
  const n = await prisma.notification.findFirstOrThrow({
    where: { type },
    orderBy: { createdAt: "desc" },
  });
  return (n.payload as { token: string }).token;
}

export const me = (accessToken: string) =>
  api().get("/api/v1/me").set("Authorization", `Bearer ${accessToken}`);

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Registered user with a verified email and an organizer profile.
 * `verified: true` also marks the organizer profile as verified (so it can publish).
 */
export async function makeOrganizer(
  email = "org@example.com",
  opts: { verified?: boolean; orgName?: string } = {},
) {
  const { res, accessToken } = await register(email);
  const id = res.body.user.id as string;
  await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  await redis.del(`user:state:${id}`);
  const created = await api()
    .post("/api/v1/me/organizer-profile")
    .set(bearer(accessToken))
    .send({ orgName: opts.orgName ?? `Org ${email.split("@")[0]}` });
  if (created.status !== 201) throw new Error(`organizer setup failed: ${created.text}`);
  if (opts.verified ?? true) {
    await prisma.organizerProfile.update({
      where: { userId: id },
      data: { verificationStatus: "verified" },
    });
  }
  return { id, token: accessToken, slug: created.body.profile.slug as string };
}

export async function makeAdmin(email = "admin@example.com") {
  await register(email);
  await prisma.user.update({ where: { email }, data: { role: "admin" } });
  return (await login(email)).accessToken;
}
