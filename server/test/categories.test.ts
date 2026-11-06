import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import { slugify } from "../src/lib/slug.js";
import { api, login, register, resetState } from "./helpers.js";

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function adminToken() {
  await register("admin@example.com");
  await prisma.user.update({ where: { email: "admin@example.com" }, data: { role: "admin" } });
  return (await login("admin@example.com")).accessToken;
}

const createCat = (token: string, body: object) =>
  api().post("/api/v1/admin/categories").set(auth(token)).send(body);

describe("slugify", () => {
  it("builds url-safe slugs", () => {
    expect(slugify("Food & Drink")).toBe("food-drink");
    expect(slugify("  Café Nights!! ")).toBe("cafe-nights");
    expect(slugify("नेपाली")).toBe("");
  });
});

describe("public /categories", () => {
  it("returns an empty list, then a sorted tree", async () => {
    let res = await api().get("/api/v1/categories");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");

    const token = await adminToken();
    const music = (await createCat(token, { name: "Music", sortOrder: 2 })).body.category;
    await createCat(token, { name: "Comedy", sortOrder: 1 });
    await createCat(token, { name: "Concerts", parentId: music.id });

    res = await api().get("/api/v1/categories");
    expect(res.body.data.map((c: { slug: string }) => c.slug)).toEqual(["comedy", "music"]);
    expect(res.body.data[1].children).toMatchObject([{ slug: "concerts", parentId: music.id }]);
  });

  it("gets one category by slug with its parent or children", async () => {
    const token = await adminToken();
    const music = (await createCat(token, { name: "Music" })).body.category;
    await createCat(token, { name: "DJ Nights", parentId: music.id });

    const top = await api().get("/api/v1/categories/MUSIC");
    expect(top.body.category).toMatchObject({ slug: "music", parent: null });
    expect(top.body.category.children).toHaveLength(1);

    const sub = await api().get("/api/v1/categories/dj-nights");
    expect(sub.body.category).toMatchObject({ slug: "dj-nights", parent: { slug: "music" } });

    expect((await api().get("/api/v1/categories/nope")).status).toBe(404);
  });

  it("serves from the Redis cache and refreshes after an admin change", async () => {
    const token = await adminToken();
    await createCat(token, { name: "Music" });
    await api().get("/api/v1/categories");
    expect(await redis.exists("cat:all")).toBe(1);

    // a row written behind the API's back is not visible while cached...
    await prisma.category.create({ data: { name: "Hidden", slug: "hidden" } });
    let res = await api().get("/api/v1/categories");
    expect(res.body.data).toHaveLength(1);

    // ...but any admin write drops the cache
    await createCat(token, { name: "Comedy" });
    res = await api().get("/api/v1/categories");
    expect(res.body.data).toHaveLength(3);
  });
});

describe("admin /admin/categories", () => {
  it("is admin-only", async () => {
    const { accessToken } = await register();
    expect((await createCat(accessToken, { name: "Music" })).status).toBe(403);
    expect((await api().post("/api/v1/admin/categories").send({ name: "Music" })).status).toBe(401);
  });

  it("creates with a generated or custom slug and writes an audit row", async () => {
    const token = await adminToken();
    const a = await createCat(token, { name: "Food & Drink" });
    expect(a.status).toBe(201);
    expect(a.headers.location).toBe("/api/v1/categories/food-drink");
    expect(a.body.category).toMatchObject({
      name: "Food & Drink",
      slug: "food-drink",
      sortOrder: 0,
    });

    const b = await createCat(token, { name: "Tech Talks", slug: "Tech" });
    expect(b.body.category.slug).toBe("tech");

    const audit = await prisma.auditLog.findMany({ where: { action: "admin.category_created" } });
    expect(audit).toHaveLength(2);
  });

  it("rejects duplicates, bad input and a third level", async () => {
    const token = await adminToken();
    const music = (await createCat(token, { name: "Music" })).body.category;

    let res = await createCat(token, { name: "MUSIC", slug: "music-2" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NAME_TAKEN");
    res = await createCat(token, { name: "Musik", slug: "music" });
    expect(res.body.code).toBe("SLUG_TAKEN");

    for (const body of [
      {},
      { name: " " },
      { name: "X", slug: "Bad Slug" },
      { name: "X", id: "1" },
    ]) {
      expect((await createCat(token, body)).status, JSON.stringify(body)).toBe(400);
    }
    res = await createCat(token, { name: "नेपाली" });
    expect(res.body.code).toBe("SLUG_REQUIRED");

    const concerts = (await createCat(token, { name: "Concerts", parentId: music.id })).body
      .category;
    res = await createCat(token, { name: "Rock", parentId: concerts.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("MAX_DEPTH");

    res = await createCat(token, {
      name: "Orphan",
      parentId: "01900000-0000-7000-8000-000000000000",
    });
    expect(res.body.code).toBe("INVALID_PARENT");
  });

  it("updates fields and moves categories between levels safely", async () => {
    const token = await adminToken();
    const music = (await createCat(token, { name: "Music" })).body.category;
    const comedy = (await createCat(token, { name: "Comedy" })).body.category;
    await createCat(token, { name: "Concerts", parentId: music.id });

    const patch = (id: string, body: object) =>
      api().patch(`/api/v1/admin/categories/${id}`).set(auth(token)).send(body);

    let res = await patch(comedy.id, { name: "Stand-up Comedy", sortOrder: 5 });
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({
      name: "Stand-up Comedy",
      slug: "comedy",
      sortOrder: 5,
    });

    // comedy → under music, then back to top level
    res = await patch(comedy.id, { parentId: music.id });
    expect(res.body.category.parentId).toBe(music.id);
    res = await patch(comedy.id, { parentId: null });
    expect(res.body.category.parentId).toBeNull();

    // music has children, so it can't become a sub-category; nor its own parent
    expect((await patch(music.id, { parentId: comedy.id })).body.code).toBe("MAX_DEPTH");
    expect((await patch(comedy.id, { parentId: comedy.id })).body.code).toBe("INVALID_PARENT");
    expect((await patch(comedy.id, { slug: "music" })).body.code).toBe("SLUG_TAKEN");
    expect((await patch(comedy.id, {})).status).toBe(400);
    expect((await patch("01900000-0000-7000-8000-000000000000", { name: "X" })).status).toBe(404);
  });

  it("deletes only categories without sub-categories", async () => {
    const token = await adminToken();
    const music = (await createCat(token, { name: "Music" })).body.category;
    const concerts = (await createCat(token, { name: "Concerts", parentId: music.id })).body
      .category;
    const del = (id: string) => api().delete(`/api/v1/admin/categories/${id}`).set(auth(token));

    let res = await del(music.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CATEGORY_HAS_CHILDREN");

    expect((await del(concerts.id)).status).toBe(204);
    expect((await del(music.id)).status).toBe(204);
    expect((await del(music.id)).status).toBe(404);
    expect((await api().get("/api/v1/categories")).body.data).toEqual([]);
  });
});
