import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decryptJson } from "../src/lib/encryption.js";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import { invalidateUserState } from "../src/modules/auth/session-state.js";
import { payoutAad } from "../src/modules/organizers/organizers.dto.js";
import { api, login, me, register, resetState } from "./helpers.js";

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const PROFILE = "/api/v1/me/organizer-profile";

/** Registered user with a verified email. */
async function verifiedUser(email = "org@example.com") {
  const { res, accessToken } = await register(email);
  const id = res.body.user.id as string;
  await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  await invalidateUserState(id);
  return { id, token: accessToken };
}

async function adminToken() {
  await register("admin@example.com");
  await prisma.user.update({ where: { email: "admin@example.com" }, data: { role: "admin" } });
  return (await login("admin@example.com")).accessToken;
}

const becomeOrganizer = (token: string, body: object = { orgName: "Kathmandu Live" }) =>
  api().post(PROFILE).set(auth(token)).send(body);

describe("POST /me/organizer-profile", () => {
  it("requires a verified email", async () => {
    const { accessToken } = await register();
    const res = await becomeOrganizer(accessToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("creates a pending profile and promotes the user to organizer", async () => {
    const { id, token } = await verifiedUser();
    const res = await becomeOrganizer(token, {
      orgName: "Kathmandu Live",
      bio: "Concerts in the valley",
      website: "https://ktmlive.example.com",
    });
    expect(res.status).toBe(201);
    expect(res.body.profile).toMatchObject({
      userId: id,
      orgName: "Kathmandu Live",
      slug: "kathmandu-live",
      verificationStatus: "pending",
      payout: null,
    });
    // same access token, new role on the next request
    expect((await me(token)).body.user.role).toBe("organizer");

    const again = await becomeOrganizer(token);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_ORGANIZER");
  });

  it("adds a suffix when the generated slug is taken, but not for a chosen slug", async () => {
    const a = await verifiedUser("a@example.com");
    const b = await verifiedUser("b@example.com");
    const c = await verifiedUser("c@example.com");
    await becomeOrganizer(a.token, { orgName: "Kathmandu Live" });

    const res = await becomeOrganizer(b.token, { orgName: "Kathmandu Live" });
    expect(res.status).toBe(201);
    expect(res.body.profile.slug).toMatch(/^kathmandu-live-[0-9a-f]{6}$/);

    const chosen = await becomeOrganizer(c.token, { orgName: "KTM", slug: "kathmandu-live" });
    expect(chosen.status).toBe(409);
    expect(chosen.body.code).toBe("SLUG_TAKEN");
  });

  it("handles non-latin names and validates input", async () => {
    const { token } = await verifiedUser();
    for (const body of [
      {},
      { orgName: "X" },
      { orgName: "Valid Name", website: "ftp://x.com" },
      { orgName: "Valid Name", logoUrl: "http://insecure.example.com/logo.png" },
      { orgName: "Valid Name", verificationStatus: "verified" },
    ]) {
      expect((await becomeOrganizer(token, body)).status, JSON.stringify(body)).toBe(400);
    }
    const res = await becomeOrganizer(token, { orgName: "काठमाडौं इभेन्ट्स" });
    expect(res.status).toBe(201);
    expect(res.body.profile.slug).toMatch(/^organizer-[0-9a-f]{6}$/);
  });

  it("keeps an admin's role", async () => {
    const { id, token } = await verifiedUser();
    await prisma.user.update({ where: { id }, data: { role: "admin" } });
    await invalidateUserState(id);
    expect((await becomeOrganizer(token)).status).toBe(201);
    expect((await me(token)).body.user.role).toBe("admin");
  });
});

describe("GET/PATCH /me/organizer-profile", () => {
  it("404s without a profile", async () => {
    const { token } = await verifiedUser();
    const res = await api().get(PROFILE).set(auth(token));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ORGANIZER_PROFILE_NOT_FOUND");
  });

  it("updates fields and clears optional ones with null", async () => {
    const { token } = await verifiedUser();
    await becomeOrganizer(token, { orgName: "Kathmandu Live", bio: "old" });
    const res = await api()
      .patch(PROFILE)
      .set(auth(token))
      .send({ bio: null, slug: "ktm-live", website: "https://ktm.example.com" });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ bio: null, slug: "ktm-live" });
    expect((await api().get(PROFILE).set(auth(token))).body.profile.slug).toBe("ktm-live");
    expect((await api().patch(PROFILE).set(auth(token)).send({})).status).toBe(400);
    const forged = await api()
      .patch(PROFILE)
      .set(auth(token))
      .send({ verificationStatus: "verified" });
    expect(forged.status).toBe(400);
  });

  it("renaming a verified organization or editing a rejected one sends it back to review", async () => {
    const { id, token } = await verifiedUser();
    await becomeOrganizer(token);
    const patch = (body: object) => api().patch(PROFILE).set(auth(token)).send(body);

    await prisma.organizerProfile.update({
      where: { userId: id },
      data: { verificationStatus: "verified" },
    });
    expect((await patch({ bio: "just the bio" })).body.profile.verificationStatus).toBe("verified");
    expect((await patch({ orgName: "New Name" })).body.profile.verificationStatus).toBe("pending");

    await prisma.organizerProfile.update({
      where: { userId: id },
      data: { verificationStatus: "rejected", reviewNote: "Add a website" },
    });
    const res = await patch({ website: "https://ktm.example.com" });
    expect(res.body.profile).toMatchObject({ verificationStatus: "pending", reviewNote: null });
  });
});

describe("payout details", () => {
  it("are stored encrypted and only returned masked", async () => {
    const { id, token } = await verifiedUser();
    await becomeOrganizer(token);
    const bank = {
      method: "bank",
      bankName: "Nabil Bank",
      branch: "Thamel",
      accountName: "Kathmandu Live Pvt Ltd",
      accountNumber: "01234567890123",
    };
    const res = await api().put(`${PROFILE}/payout`).set(auth(token)).send(bank);
    expect(res.status).toBe(200);
    expect(res.body.profile.payout).toEqual({
      method: "bank",
      bankName: "Nabil Bank",
      branch: "Thamel",
      accountName: "Kathmandu Live Pvt Ltd",
      accountNumber: "**********0123",
    });

    const row = await prisma.organizerProfile.findUniqueOrThrow({ where: { userId: id } });
    expect(row.payoutMethod).toBe("bank");
    expect(JSON.stringify(row.payoutDetails)).not.toContain("01234567890123");
    expect(decryptJson(row.payoutDetails, payoutAad(id))).toEqual(bank);
    // bound to this row: another user's id can't decrypt it
    expect(() => decryptJson(row.payoutDetails, payoutAad("someone-else"))).toThrow();

    const wallet = await api()
      .put(`${PROFILE}/payout`)
      .set(auth(token))
      .send({ method: "esewa", walletId: "9812345678", accountName: "Ram Sharma" });
    expect(wallet.body.profile.payout).toEqual({
      method: "esewa",
      accountName: "Ram Sharma",
      walletId: "98******78",
    });

    const audit = await prisma.auditLog.findMany({ where: { action: "organizer.payout_updated" } });
    expect(JSON.stringify(audit.map((a) => a.diff))).not.toContain("9812345678");

    expect((await api().delete(`${PROFILE}/payout`).set(auth(token))).status).toBe(204);
    expect((await api().get(PROFILE).set(auth(token))).body.profile.payout).toBeNull();
  });

  it("validates per method", async () => {
    const { token } = await verifiedUser();
    await becomeOrganizer(token);
    for (const body of [
      { method: "paypal", email: "x@y.z" },
      { method: "esewa", walletId: "12345", accountName: "Ram" },
      { method: "khalti", walletId: "9812345678" },
      { method: "bank", bankName: "Nabil", accountName: "Ram", accountNumber: "12" },
      { method: "esewa", walletId: "9812345678", accountName: "Ram", bankName: "x" },
    ]) {
      const res = await api().put(`${PROFILE}/payout`).set(auth(token)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("GET /organizers/:slug", () => {
  it("shows the public profile without private fields", async () => {
    const { id, token } = await verifiedUser();
    await becomeOrganizer(token, { orgName: "Kathmandu Live", bio: "Concerts" });
    await api()
      .put(`${PROFILE}/payout`)
      .set(auth(token))
      .send({ method: "khalti", walletId: "9812345678", accountName: "Ram" });

    const res = await api().get("/api/v1/organizers/KATHMANDU-LIVE");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.body.organizer).toEqual({
      orgName: "Kathmandu Live",
      slug: "kathmandu-live",
      bio: "Concerts",
      logoUrl: null,
      website: null,
      verified: false,
      memberSince: expect.any(String),
    });

    await prisma.organizerProfile.update({
      where: { userId: id },
      data: { verificationStatus: "rejected", reviewNote: "x" },
    });
    expect((await api().get("/api/v1/organizers/kathmandu-live")).status).toBe(404);

    await prisma.organizerProfile.update({
      where: { userId: id },
      data: { verificationStatus: "verified", reviewNote: null },
    });
    await prisma.user.update({ where: { id }, data: { status: "suspended" } });
    expect((await api().get("/api/v1/organizers/kathmandu-live")).status).toBe(404);
    expect((await api().get("/api/v1/organizers/nope")).status).toBe(404);
  });
});

describe("admin /admin/organizers", () => {
  it("is admin-only", async () => {
    const { token } = await verifiedUser();
    expect((await api().get("/api/v1/admin/organizers").set(auth(token))).status).toBe(403);
  });

  it("lists with filters and cursor pagination", async () => {
    const admin = await adminToken();
    for (const n of [1, 2, 3]) {
      const u = await verifiedUser(`org${n}@example.com`);
      await becomeOrganizer(u.token, { orgName: `Org Number ${n}` });
    }
    const first = await api().get("/api/v1/admin/organizers?limit=2").set(auth(admin));
    expect(first.status).toBe(200);
    expect(first.body.data.map((o: { slug: string }) => o.slug)).toEqual([
      "org-number-3",
      "org-number-2",
    ]);
    expect(first.body.data[0].owner.email).toBe("org3@example.com");

    const second = await api()
      .get(`/api/v1/admin/organizers?limit=2&cursor=${first.body.page.nextCursor}`)
      .set(auth(admin));
    expect(second.body.data.map((o: { slug: string }) => o.slug)).toEqual(["org-number-1"]);
    expect(second.body.page.hasMore).toBe(false);

    const search = await api().get("/api/v1/admin/organizers?q=org2@").set(auth(admin));
    expect(search.body.data).toHaveLength(1);
    const verified = await api().get("/api/v1/admin/organizers?status=verified").set(auth(admin));
    expect(verified.body.data).toEqual([]);
  });

  it("verifies and rejects with an audit row and an email", async () => {
    const admin = await adminToken();
    const { id, token } = await verifiedUser();
    await becomeOrganizer(token);
    const review = (body: object) =>
      api().patch(`/api/v1/admin/organizers/${id}/verification`).set(auth(admin)).send(body);

    expect((await review({ status: "rejected" })).status).toBe(400); // note required
    let res = await review({ status: "rejected", note: "Please add a website" });
    expect(res.status).toBe(200);
    expect(res.body.organizer).toMatchObject({
      verificationStatus: "rejected",
      reviewNote: "Please add a website",
      owner: { email: "org@example.com" },
    });
    let mail = await prisma.notification.findFirstOrThrow({
      where: { type: "organizer.rejected" },
    });
    expect(mail.payload).toMatchObject({ note: "Please add a website" });

    res = await review({ status: "verified" });
    expect(res.body.organizer).toMatchObject({ verificationStatus: "verified", reviewNote: null });
    mail = await prisma.notification.findFirstOrThrow({ where: { type: "organizer.verified" } });
    expect(mail.recipient).toBe("org@example.com");

    const audits = await prisma.auditLog.findMany({
      where: { action: { startsWith: "admin.organizer_" } },
      orderBy: { id: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "admin.organizer_rejected",
      "admin.organizer_verified",
    ]);

    const pub = await api().get("/api/v1/organizers/kathmandu-live");
    expect(pub.body.organizer.verified).toBe(true);

    const missing = await api()
      .patch("/api/v1/admin/organizers/01900000-0000-7000-8000-000000000000/verification")
      .set(auth(admin))
      .send({ status: "verified" });
    expect(missing.status).toBe(404);
  });
});
