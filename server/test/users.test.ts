import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import { api, login, me, register, resetState } from "./helpers.js";

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Registers a user and makes them admin directly in the DB. */
async function makeAdmin(email = "admin@example.com") {
  await register(email);
  await prisma.user.update({ where: { email }, data: { role: "admin" } });
  const { accessToken } = await login(email);
  return accessToken;
}

describe("GET/PATCH /me", () => {
  it("requires authentication", async () => {
    expect((await api().get("/api/v1/me")).status).toBe(401);
    expect((await api().patch("/api/v1/me").send({ fullName: "X" })).status).toBe(401);
  });

  it("updates name and phone, and clears phone with null", async () => {
    const { accessToken } = await register();
    let res = await api()
      .patch("/api/v1/me")
      .set(auth(accessToken))
      .send({ fullName: "  Alice Updated ", phone: "+977 9812345678" });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body.user).toMatchObject({ fullName: "Alice Updated", phone: "+977 9812345678" });

    res = await api().patch("/api/v1/me").set(auth(accessToken)).send({ phone: null });
    expect(res.body.user.phone).toBeNull();
    expect((await me(accessToken)).body.user.fullName).toBe("Alice Updated");
  });

  it("rejects protected fields, empty bodies and invalid values", async () => {
    const { accessToken } = await register();
    for (const body of [
      { role: "admin" },
      { email: "x@example.com" },
      { emailVerified: true },
      {},
      { fullName: "   " },
      { phone: "abc" },
    ]) {
      const res = await api().patch("/api/v1/me").set(auth(accessToken)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    }
    expect((await me(accessToken)).body.user.role).toBe("attendee");
  });
});

describe("admin /admin/users", () => {
  it("is forbidden for non-admins and anonymous users", async () => {
    const { accessToken } = await register();
    expect((await api().get("/api/v1/admin/users")).status).toBe(401);
    const res = await api().get("/api/v1/admin/users").set(auth(accessToken));
    expect(res.status).toBe(403);
  });

  it("lists users newest first with cursor pagination and filters", async () => {
    const token = await makeAdmin();
    for (const n of [1, 2, 3]) await register(`user${n}@example.com`);

    const first = await api().get("/api/v1/admin/users?limit=2").set(auth(token));
    expect(first.status).toBe(200);
    expect(first.body.data.map((u: { email: string }) => u.email)).toEqual([
      "user3@example.com",
      "user2@example.com",
    ]);
    expect(first.body.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(first.body.data[0].passwordHash).toBeUndefined();
    expect(first.body.data[0].status).toBe("active");

    const second = await api()
      .get(`/api/v1/admin/users?limit=2&cursor=${first.body.page.nextCursor}`)
      .set(auth(token));
    expect(second.body.data.map((u: { email: string }) => u.email)).toEqual([
      "user1@example.com",
      "admin@example.com",
    ]);
    expect(second.body.page).toMatchObject({ hasMore: false, nextCursor: null });

    const search = await api().get("/api/v1/admin/users?q=USER2").set(auth(token));
    expect(search.body.data).toHaveLength(1);
    const admins = await api().get("/api/v1/admin/users?role=admin").set(auth(token));
    expect(admins.body.data.map((u: { email: string }) => u.email)).toEqual(["admin@example.com"]);

    const bad = await api().get("/api/v1/admin/users?cursor=garbage").set(auth(token));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_CURSOR");
  });

  it("gets one user with their active session count", async () => {
    const token = await makeAdmin();
    const { res } = await register("bob@example.com");
    const id = res.body.user.id as string;
    const got = await api().get(`/api/v1/admin/users/${id}`).set(auth(token));
    expect(got.status).toBe(200);
    expect(got.body.user).toMatchObject({ email: "bob@example.com", activeSessions: 1 });

    const missing = await api()
      .get("/api/v1/admin/users/01900000-0000-7000-8000-000000000000")
      .set(auth(token));
    expect(missing.status).toBe(404);
  });

  it("suspending signs the user out immediately and blocks login; reactivating restores access", async () => {
    const token = await makeAdmin();
    const bob = await register("bob@example.com");
    const id = bob.res.body.user.id as string;

    const res = await api()
      .patch(`/api/v1/admin/users/${id}`)
      .set(auth(token))
      .send({ status: "suspended" });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("suspended");

    // the existing access token dies right away (session revoked)
    expect((await me(bob.accessToken)).status).toBe(401);
    // and a new login is refused
    const relog = await login("bob@example.com");
    expect(relog.res.status).toBe(403);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "admin.user_updated" },
    });
    expect(audit.entityId).toBe(id);
    expect(audit.diff).toMatchObject({
      before: { status: "active" },
      after: { status: "suspended" },
      sessionsRevoked: 1,
    });

    await api().patch(`/api/v1/admin/users/${id}`).set(auth(token)).send({ status: "active" });
    expect((await login("bob@example.com")).res.status).toBe(200);
  });

  it("role changes apply on the user's next request", async () => {
    const token = await makeAdmin();
    const bob = await register("bob@example.com");
    const id = bob.res.body.user.id as string;
    // warm bob's cached auth state
    expect((await api().get("/api/v1/admin/users").set(auth(bob.accessToken))).status).toBe(403);

    await api().patch(`/api/v1/admin/users/${id}`).set(auth(token)).send({ role: "admin" });
    const res = await api().get("/api/v1/admin/users").set(auth(bob.accessToken));
    expect(res.status).toBe(200);
  });

  it("admins can't change themselves, and the body is validated", async () => {
    const token = await makeAdmin();
    const self = (await me(token)).body.user.id as string;
    const res = await api()
      .patch(`/api/v1/admin/users/${self}`)
      .set(auth(token))
      .send({ role: "attendee" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CANNOT_MODIFY_SELF");

    const { res: bob } = await register("bob@example.com");
    for (const body of [{}, { status: "deleted" }, { role: "root" }, { email: "x@y.z" }]) {
      const r = await api()
        .patch(`/api/v1/admin/users/${bob.body.user.id}`)
        .set(auth(token))
        .send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });
});
