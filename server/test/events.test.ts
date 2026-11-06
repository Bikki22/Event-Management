import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import { completeEndedEvents } from "../src/modules/events/events.service.js";
import { api, bearer, makeAdmin, makeOrganizer, register, resetState } from "./helpers.js";

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

const DAY = 86_400_000;
const inDays = (d: number, hours = 0) => new Date(Date.now() + d * DAY + hours * 3_600_000);

const onlineEvent = (over: object = {}) => ({
  title: "Jazz Night Online",
  mode: "online",
  onlineUrl: "https://meet.example.com/jazz",
  startsAt: inDays(7).toISOString(),
  endsAt: inDays(7, 3).toISOString(),
  ...over,
});

const createEvent = (token: string, body: object = onlineEvent()) =>
  api().post("/api/v1/events").set(bearer(token)).send(body);

const patchEvent = (token: string, id: string, body: object, version?: number) => {
  const r = api().patch(`/api/v1/events/${id}`).set(bearer(token));
  if (version !== undefined) r.set("If-Match", `"v${version}"`);
  return r.send(body);
};

const addTicket = (token: string, eventId: string, body: object = {}) =>
  api()
    .post(`/api/v1/events/${eventId}/ticket-types`)
    .set(bearer(token))
    .send({ name: "General", price: 50000, quantityTotal: 100, ...body });

async function category(slug = "music", parentId: string | null = null) {
  return prisma.category.create({ data: { name: slug, slug, parentId } });
}

/** A published online event, ready for listing tests. */
async function publishedEvent(token: string, over: object = {}) {
  const music =
    (await prisma.category.findUnique({ where: { slug: "music" } })) ?? (await category());
  const e = await createEvent(
    token,
    onlineEvent({ summary: "Live music", categoryId: music.id, ...over }),
  );
  expect(e.status).toBe(201);
  await addTicket(token, e.body.event.id);
  const p = await api().post(`/api/v1/events/${e.body.event.id}/publish`).set(bearer(token));
  expect(p.status).toBe(200);
  return p.body.event;
}

describe("venues", () => {
  it("organizers create and manage their own; admins create shared ones", async () => {
    const org = await makeOrganizer();
    const other = await makeOrganizer("other@example.com");
    const admin = await makeAdmin();

    const own = await api().post("/api/v1/venues").set(bearer(org.token)).send({
      name: "Tudikhel Hall",
      city: "Kathmandu",
      capacity: 500,
      latitude: 27.7,
      longitude: 85.3,
    });
    expect(own.status).toBe(201);
    expect(own.body.venue).toMatchObject({ platform: false, country: "Nepal", latitude: 27.7 });

    const shared = await api()
      .post("/api/v1/venues")
      .set(bearer(admin))
      .send({ name: "Dasharath Stadium", city: "Kathmandu", platform: true });
    expect(shared.body.venue.platform).toBe(true);

    // non-admins can't create shared venues; non-organizers can't create any
    expect(
      (
        await api()
          .post("/api/v1/venues")
          .set(bearer(org.token))
          .send({ name: "X Hall", city: "Pokhara", platform: true })
      ).status,
    ).toBe(403);
    const plain = await register("plain@example.com");
    const r = await api()
      .post("/api/v1/venues")
      .set(bearer(plain.accessToken))
      .send({ name: "X Hall", city: "Pokhara" });
    expect(r.body.code).toBe("NOT_AN_ORGANIZER");

    // picker: own + shared, not other organizers' venues
    const list = await api().get("/api/v1/venues").set(bearer(other.token));
    expect(list.body.data.map((v: { name: string }) => v.name)).toEqual(["Dasharath Stadium"]);
    expect((await api().get(`/api/v1/venues/${own.body.venue.id}`)).status).toBe(200); // public read

    // only the owner (or an admin) can edit
    const id = own.body.venue.id as string;
    expect(
      (await api().patch(`/api/v1/venues/${id}`).set(bearer(other.token)).send({ capacity: 1 }))
        .status,
    ).toBe(404);
    expect(
      (await api().patch(`/api/v1/venues/${id}`).set(bearer(org.token)).send({ capacity: 800 }))
        .body.venue.capacity,
    ).toBe(800);
    expect(
      (await api().patch(`/api/v1/venues/${id}`).set(bearer(org.token)).send({ latitude: 1 }))
        .status,
    ).toBe(400);
  });

  it("can't be deleted while an event uses it", async () => {
    const org = await makeOrganizer();
    const venue = (
      await api()
        .post("/api/v1/venues")
        .set(bearer(org.token))
        .send({ name: "Hall", city: "Kathmandu" })
    ).body.venue;
    const e = await createEvent(org.token, {
      ...onlineEvent(),
      mode: "in_person",
      venueId: venue.id,
      onlineUrl: undefined,
    });
    expect(e.status).toBe(201);

    let res = await api().delete(`/api/v1/venues/${venue.id}`).set(bearer(org.token));
    expect(res.body.code).toBe("VENUE_IN_USE");
    await api().delete(`/api/v1/events/${e.body.event.id}`).set(bearer(org.token));
    res = await api().delete(`/api/v1/venues/${venue.id}`).set(bearer(org.token));
    expect(res.status).toBe(204);
    expect((await api().get(`/api/v1/venues/${venue.id}`)).status).toBe(404);
  });
});

describe("create events", () => {
  it("only organizers can create; a draft with a generated slug and ETag v0", async () => {
    const plain = await register();
    expect((await createEvent(plain.accessToken)).body.code).toBe("NOT_AN_ORGANIZER");

    const org = await makeOrganizer("org@example.com", { verified: false }); // drafts need no verification
    const res = await createEvent(org.token);
    expect(res.status).toBe(201);
    expect(res.headers.etag).toBe('"v0"');
    expect(res.body.event).toMatchObject({
      slug: "jazz-night-online",
      status: "draft",
      visibility: "public",
      timezone: "Asia/Kathmandu",
      version: 0,
      onlineUrl: "https://meet.example.com/jazz",
    });
    const second = await createEvent(org.token);
    expect(second.body.event.slug).toMatch(/^jazz-night-online-[0-9a-f]{6}$/);
  });

  it("validates dates, venue, seating and references", async () => {
    const org = await makeOrganizer();
    const other = await makeOrganizer("other@example.com");
    const theirVenue = (
      await api()
        .post("/api/v1/venues")
        .set(bearer(other.token))
        .send({ name: "Theirs", city: "Pokhara" })
    ).body.venue;

    const cases: [object, number, string][] = [
      [onlineEvent({ startsAt: inDays(-1).toISOString() }), 422, "INVALID_DATES"],
      [onlineEvent({ endsAt: inDays(6).toISOString() }), 422, "INVALID_DATES"],
      [onlineEvent({ endsAt: inDays(60).toISOString() }), 422, "INVALID_DATES"],
      [onlineEvent({ mode: "in_person" }), 422, "VENUE_REQUIRED"],
      [onlineEvent({ mode: "in_person", venueId: theirVenue.id }), 422, "INVALID_VENUE"],
      [onlineEvent({ seatingType: "reserved" }), 422, "RESERVED_SEATING_UNAVAILABLE"],
      [
        onlineEvent({ categoryId: "01900000-0000-7000-8000-000000000000" }),
        422,
        "INVALID_CATEGORY",
      ],
      [onlineEvent({ status: "published" }), 400, "VALIDATION_FAILED"],
      [onlineEvent({ onlineUrl: "http://insecure.example.com" }), 400, "VALIDATION_FAILED"],
      [onlineEvent({ timezone: "Mars/Olympus" }), 400, "VALIDATION_FAILED"],
      [onlineEvent({ startsAt: "next friday" }), 400, "VALIDATION_FAILED"],
    ];
    for (const [body, status, code] of cases) {
      const res = await createEvent(org.token, body);
      expect([res.status, res.body.code], JSON.stringify(body)).toEqual([status, code]);
    }
  });
});

describe("edit events (If-Match)", () => {
  it("requires the current version", async () => {
    const org = await makeOrganizer();
    const id = (await createEvent(org.token)).body.event.id as string;

    expect((await patchEvent(org.token, id, { title: "New" })).status).toBe(428);
    expect((await patchEvent(org.token, id, { title: "New" }, 5)).status).toBe(412);

    const ok = await patchEvent(org.token, id, { title: "New Title", summary: "Short" }, 0);
    expect(ok.status).toBe(200);
    expect(ok.headers.etag).toBe('"v1"');
    expect(ok.body.event).toMatchObject({ title: "New Title", version: 1 });

    // a second editor still holding v0 is refused instead of overwriting
    const stale = await patchEvent(org.token, id, { title: "Other" }, 0);
    expect(stale.status).toBe(412);
    expect(stale.body.code).toBe("PRECONDITION_FAILED");
  });

  it("only the owner can edit; nobody else even sees a draft", async () => {
    const org = await makeOrganizer();
    const other = await makeOrganizer("other@example.com");
    const admin = await makeAdmin();
    const e = (await createEvent(org.token)).body.event;

    expect((await patchEvent(other.token, e.id, { title: "Hacked" }, 0)).status).toBe(404);
    expect((await api().get(`/api/v1/events/${e.slug}`)).status).toBe(404);
    expect((await api().get(`/api/v1/events/${e.id}`).set(bearer(other.token))).status).toBe(404);
    // owner and admin see the management view
    const own = await api().get(`/api/v1/events/${e.slug}`).set(bearer(org.token));
    expect(own.headers["cache-control"]).toBe("private, no-store");
    expect(own.headers.etag).toBe('"v0"');
    expect((await api().get(`/api/v1/events/${e.id}`).set(bearer(admin))).body.event.version).toBe(
      0,
    );
  });
});

describe("publish", () => {
  it("needs a verified organizer and a complete event", async () => {
    const unverified = await makeOrganizer("new@example.com", { verified: false });
    const draft = (await createEvent(unverified.token)).body.event;
    let res = await api().post(`/api/v1/events/${draft.id}/publish`).set(bearer(unverified.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ORGANIZER_NOT_VERIFIED");

    const org = await makeOrganizer();
    const e = (await createEvent(org.token)).body.event;
    res = await api().post(`/api/v1/events/${e.id}/publish`).set(bearer(org.token));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("EVENT_INCOMPLETE");
    expect(res.body.details.missing).toEqual([
      "summary",
      "categoryId",
      "ticketTypes (at least one active)",
    ]);

    const music = await category();
    await patchEvent(org.token, e.id, { summary: "Smooth jazz", categoryId: music.id }, 0);
    await addTicket(org.token, e.id);
    res = await api().post(`/api/v1/events/${e.id}/publish`).set(bearer(org.token));
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({ status: "published", version: 2 });
    expect(res.body.event.publishedAt).toBeTruthy();

    res = await api().post(`/api/v1/events/${e.id}/publish`).set(bearer(org.token));
    expect(res.body.code).toBe("INVALID_STATE");
  });

  it("published events are public, hide private fields and lock their URL", async () => {
    const org = await makeOrganizer();
    const e = await publishedEvent(org.token);

    const pub = await api().get(`/api/v1/events/${e.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.headers["cache-control"]).toBe("public, max-age=30, stale-while-revalidate=60");
    expect(pub.body.event.onlineUrl).toBeUndefined();
    expect(pub.body.event.version).toBeUndefined();
    expect(pub.body.event.ticketTypes[0]).toMatchObject({
      name: "General",
      price: 50000,
      currency: "NPR",
      available: 100,
      onSale: true,
      soldOut: false,
    });
    expect(pub.body.event.ticketTypes[0].quantitySold).toBeUndefined();
    expect(pub.body.event.organizer).toMatchObject({ slug: org.slug, verified: true });

    const res = await patchEvent(org.token, e.id, { slug: "new-url" }, e.version);
    expect(res.body.code).toBe("SLUG_LOCKED");
    expect((await api().delete(`/api/v1/events/${e.id}`).set(bearer(org.token))).body.code).toBe(
      "EVENT_NOT_DELETABLE",
    );
  });

  it("private events are hidden; unlisted are reachable by link but not listed", async () => {
    const org = await makeOrganizer();
    const priv = await publishedEvent(org.token, { title: "Private Party", visibility: "private" });
    const unl = await publishedEvent(org.token, { title: "Secret Gig", visibility: "unlisted" });
    expect((await api().get(`/api/v1/events/${priv.slug}`)).status).toBe(404);
    expect((await api().get(`/api/v1/events/${unl.slug}`)).status).toBe(200);
    expect((await api().get("/api/v1/events")).body.data).toEqual([]);
  });
});

describe("cancel / delete / complete", () => {
  it("owner or admin cancels a published event; then it's read-only", async () => {
    const org = await makeOrganizer();
    const other = await makeOrganizer("other@example.com");
    const admin = await makeAdmin();
    const e = await publishedEvent(org.token);
    const cancel = (token: string, id = e.id) =>
      api()
        .post(`/api/v1/events/${id}/cancel`)
        .set(bearer(token))
        .send({ reason: "Venue flooded" });

    expect((await cancel(other.token)).status).toBe(404);
    const res = await cancel(admin);
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      status: "cancelled",
      cancellationReason: "Venue flooded",
    });
    expect((await cancel(org.token)).body.code).toBe("INVALID_STATE");
    expect(
      (await patchEvent(org.token, e.id, { title: "Renamed" }, res.body.event.version)).body.code,
    ).toBe("EVENT_NOT_EDITABLE");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "admin.event_cancelled" },
    });
    expect(audit.diff).toMatchObject({ reason: "Venue flooded" });

    // still viewable, showing the cancellation
    expect((await api().get(`/api/v1/events/${e.slug}`)).body.event.status).toBe("cancelled");

    const draft = (await createEvent(org.token)).body.event;
    expect((await cancel(org.token, draft.id)).body.code).toBe("INVALID_STATE");
    expect((await api().delete(`/api/v1/events/${draft.id}`).set(bearer(org.token))).status).toBe(
      204,
    );
    expect((await api().get(`/api/v1/events/${draft.id}`).set(bearer(org.token))).status).toBe(404);
  });

  it("the maintenance job completes ended events", async () => {
    const org = await makeOrganizer();
    const e = await publishedEvent(org.token);
    await prisma.$executeRaw`UPDATE events SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' WHERE id = ${e.id}::uuid`;
    expect(await completeEndedEvents()).toBe(1);
    const after = await prisma.event.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("completed");
  });
});

describe("ticket types", () => {
  it("create, unique names, If-Match edits, and stock rules", async () => {
    const org = await makeOrganizer();
    const e = (await createEvent(org.token)).body.event;
    const base = `/api/v1/events/${e.id}/ticket-types`;

    const vip = await addTicket(org.token, e.id, {
      name: "VIP",
      price: 250000,
      quantityTotal: 20,
      maxPerOrder: 4,
    });
    expect(vip.status).toBe(201);
    expect(vip.headers.etag).toBe('"v0"');
    expect(vip.body.ticketType).toMatchObject({ price: 250000, available: 20, quantitySold: 0 });
    expect((await addTicket(org.token, e.id, { name: "vip" })).status).toBe(201); // different case → allowed name
    expect((await addTicket(org.token, e.id, { name: "VIP" })).body.code).toBe(
      "TICKET_TYPE_EXISTS",
    );

    // invalid windows / per-order limits
    expect(
      (await addTicket(org.token, e.id, { name: "A", minPerOrder: 5, maxPerOrder: 2 })).status,
    ).toBe(400);
    expect(
      (await addTicket(org.token, e.id, { name: "B", salesEndAt: inDays(30).toISOString() })).body
        .code,
    ).toBe("INVALID_SALES_WINDOW");
    expect((await addTicket(org.token, e.id, { name: "C", price: -1 })).status).toBe(400);

    const id = vip.body.ticketType.id as string;
    const patch = (body: object, v?: number) => {
      const r = api().patch(`${base}/${id}`).set(bearer(org.token));
      if (v !== undefined) r.set("If-Match", `"v${v}"`);
      return r.send(body);
    };
    expect((await patch({ price: 300000 })).status).toBe(428);
    let res = await patch({ price: 300000 }, 0);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('"v1"');

    // simulate sales: price locks, total can't drop below sold + reserved
    await prisma.ticketType.update({
      where: { id },
      data: { quantitySold: 15, quantityReserved: 3 },
    });
    expect((await patch({ price: 1 }, 1)).body.code).toBe("PRICE_LOCKED");
    expect((await patch({ quantityTotal: 17 }, 1)).body.code).toBe("QUANTITY_BELOW_SOLD");
    res = await patch({ quantityTotal: 18, description: "Front rows" }, 1);
    expect(res.body.ticketType).toMatchObject({ quantityTotal: 18, available: 0, soldOut: true });

    expect((await api().delete(`${base}/${id}`).set(bearer(org.token))).body.code).toBe(
      "TICKET_TYPE_HAS_SALES",
    );
  });

  it("a published event keeps at least one active ticket type", async () => {
    const org = await makeOrganizer();
    const e = await publishedEvent(org.token);
    const tt = e.ticketTypes[0];
    const base = `/api/v1/events/${e.id}/ticket-types/${tt.id}`;

    let res = await api()
      .patch(base)
      .set(bearer(org.token))
      .set("If-Match", '"v0"')
      .send({ isActive: false });
    expect(res.body.code).toBe("LAST_TICKET_TYPE");
    expect((await api().delete(base).set(bearer(org.token))).body.code).toBe("LAST_TICKET_TYPE");

    await addTicket(org.token, e.id, { name: "Early Bird", price: 30000 });
    res = await api().delete(base).set(bearer(org.token));
    expect(res.status).toBe(204);
  });

  it("public list hides inactive types and stock counts; owner sees all", async () => {
    const org = await makeOrganizer();
    const e = await publishedEvent(org.token);
    await addTicket(org.token, e.id, { name: "Hidden", isActive: false });

    const pub = await api().get(`/api/v1/events/${e.id}/ticket-types`);
    expect(pub.body.data.map((t: { name: string }) => t.name)).toEqual(["General"]);
    expect(pub.body.data[0].quantityTotal).toBeUndefined();
    const own = await api().get(`/api/v1/events/${e.id}/ticket-types`).set(bearer(org.token));
    expect(own.body.data).toHaveLength(2);

    const avail = await api().get(`/api/v1/events/${e.id}/availability`);
    expect(avail.headers["cache-control"]).toBe("public, max-age=3");
    expect(avail.body.ticketTypes).toEqual([
      { ticketTypeId: e.ticketTypes[0].id, available: 100, soldOut: false, onSale: true },
    ]);
  });
});

describe("public listing", () => {
  it("filters, searches and paginates", async () => {
    const org = await makeOrganizer("org@example.com", { orgName: "Kathmandu Live" });
    const music = await category("music");
    const jazz = await category("jazz", music.id);
    const comedy = await category("comedy");
    const hall = (
      await api()
        .post("/api/v1/venues")
        .set(bearer(org.token))
        .send({ name: "Hall", city: "Pokhara" })
    ).body.venue;

    await publishedEvent(org.token, {
      title: "Jazz by the Lake",
      categoryId: jazz.id,
      startsAt: inDays(3).toISOString(),
      endsAt: inDays(3, 2).toISOString(),
      mode: "in_person",
      venueId: hall.id,
      onlineUrl: undefined,
    });
    await publishedEvent(org.token, {
      title: "Rock Concert",
      categoryId: music.id,
      startsAt: inDays(5).toISOString(),
      endsAt: inDays(5, 2).toISOString(),
    });
    await publishedEvent(org.token, {
      title: "Stand-up Night",
      categoryId: comedy.id,
      summary: "Laughs and jazz hands",
      startsAt: inDays(9).toISOString(),
      endsAt: inDays(9, 2).toISOString(),
    });
    await createEvent(org.token, onlineEvent({ title: "Draft Jazz" })); // drafts never listed

    const titles = (r: { body: { data: { title: string }[] } }) => r.body.data.map((e) => e.title);
    const get = (qs: string) => api().get(`/api/v1/events${qs}`);

    const all = await get("");
    expect(titles(all)).toEqual(["Jazz by the Lake", "Rock Concert", "Stand-up Night"]);
    expect(all.body.data[0]).toMatchObject({
      venue: { name: "Hall", city: "Pokhara" },
      category: { slug: "jazz" },
      organizer: { orgName: "Kathmandu Live", verified: true },
      priceFrom: 50000,
      soldOut: false,
    });
    expect(all.body.data[0].description).toBeUndefined();

    expect(titles(await get("?category=music"))).toEqual(["Jazz by the Lake", "Rock Concert"]); // incl. sub-category
    expect(titles(await get("?category=jazz"))).toEqual(["Jazz by the Lake"]);
    expect(titles(await get("?q=jazz"))).toEqual(["Jazz by the Lake", "Stand-up Night"]); // title + summary
    expect(titles(await get("?city=POKHARA"))).toEqual(["Jazz by the Lake"]);
    expect(titles(await get("?mode=online"))).toEqual(["Rock Concert", "Stand-up Night"]);
    expect(
      titles(await get(`?from=${inDays(4).toISOString()}&to=${inDays(6).toISOString()}`)),
    ).toEqual(["Rock Concert"]);
    expect(titles(await get(`?organizer=${org.slug}`))).toHaveLength(3);
    expect(titles(await get("?q=nothing-matches"))).toEqual([]);

    const p1 = await get("?limit=2");
    expect(titles(p1)).toEqual(["Jazz by the Lake", "Rock Concert"]);
    expect(p1.body.page.hasMore).toBe(true);
    const p2 = await get(`?limit=2&cursor=${p1.body.page.nextCursor}`);
    expect(titles(p2)).toEqual(["Stand-up Night"]);
    expect(p2.body.page).toMatchObject({ hasMore: false, nextCursor: null });
    expect((await get("?cursor=bogus")).body.code).toBe("INVALID_CURSOR");

    // organizer page lists upcoming events
    const page = await api().get(`/api/v1/organizers/${org.slug}`);
    expect(page.body.upcomingEvents).toHaveLength(3);
  });

  it("organizer dashboard lists own events of every status", async () => {
    const org = await makeOrganizer();
    await publishedEvent(org.token, { title: "Live One" });
    await createEvent(org.token, onlineEvent({ title: "Draft One" }));
    await makeOrganizer("other@example.com").then((o) =>
      createEvent(o.token, onlineEvent({ title: "Not Mine" })),
    );

    const res = await api().get("/api/v1/me/events").set(bearer(org.token));
    expect(res.status).toBe(200);
    expect(
      res.body.data.map((e: { title: string; status: string }) => [e.title, e.status]),
    ).toEqual([
      ["Draft One", "draft"],
      ["Live One", "published"],
    ]);
    expect(res.body.data[1]).toMatchObject({ ticketsSold: 0, ticketsTotal: 100 });
    const drafts = await api().get("/api/v1/me/events?status=draft").set(bearer(org.token));
    expect(drafts.body.data).toHaveLength(1);
  });
});
