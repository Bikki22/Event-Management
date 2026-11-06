import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import { confirmInTx, expire, sweepExpired } from "../src/modules/bookings/bookings.service.js";
import {
  api,
  bearer,
  book,
  buyer,
  makeOrganizer,
  publishedEvent,
  register,
  resetState,
} from "./helpers.js";

beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

const stock = (id: string) =>
  prisma.ticketType.findUniqueOrThrow({
    where: { id },
    select: { quantityReserved: true, quantitySold: true, quantityTotal: true },
  });

describe("create booking", () => {
  it("needs a verified email and an Idempotency-Key", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token);
    const body = { eventId, items: [{ ticketTypeId, quantity: 1 }] };

    const unverified = await register("new@example.com");
    expect((await book(unverified.accessToken, body)).body.code).toBe("EMAIL_NOT_VERIFIED");

    const b = await buyer();
    const noKey = await api().post("/api/v1/bookings").set(bearer(b.token)).send(body);
    expect(noKey.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect((await book(b.token, body, "short")).body.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("holds stock for a paid booking until it is paid, cancelled or expires", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, { price: 150000 });
    const b = await buyer();

    const res = await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 3 }] });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      status: "pending",
      subtotal: 450000,
      totalAmount: 450000,
      currency: "NPR",
      items: [{ ticketTypeId, name: "General", quantity: 3, unitPrice: 150000, lineTotal: 450000 }],
      tickets: [],
    });
    expect(res.body.booking.bookingCode).toMatch(/^EVT-[0-9A-Z]{8}$/);
    const expiresIn = Date.parse(res.body.booking.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(9 * 60_000);
    expect(await stock(ticketTypeId)).toMatchObject({ quantityReserved: 3, quantitySold: 0 });

    // public availability already reflects the hold
    const avail = await api().get(`/api/v1/events/${eventId}/availability`);
    expect(avail.body.ticketTypes[0].available).toBe(97);
  });

  it("replays the same Idempotency-Key instead of booking twice", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token);
    const b = await buyer();
    const body = { eventId, items: [{ ticketTypeId, quantity: 2 }] };

    const first = await book(b.token, body, "double-click-key-1");
    const again = await book(b.token, body, "double-click-key-1");
    expect(again.status).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.booking.id).toBe(first.body.booking.id);
    expect(await prisma.booking.count()).toBe(1);
    expect(await stock(ticketTypeId)).toMatchObject({ quantityReserved: 2 });

    const different = await book(
      b.token,
      { ...body, items: [{ ticketTypeId, quantity: 1 }] },
      "double-click-key-1",
    );
    expect(different.status).toBe(422);
    expect(different.body.code).toBe("IDEMPOTENCY_KEY_REUSED");

    // even if Redis lost the key, the DB unique (user_id, idempotency_key) returns the original
    await redis.flushdb();
    const afterFlush = await book(b.token, body, "double-click-key-1");
    expect(afterFlush.status).toBe(200);
    expect(afterFlush.body.booking.id).toBe(first.body.booking.id);
    expect(await stock(ticketTypeId)).toMatchObject({ quantityReserved: 2 });
  });

  it("never oversells: 30 parallel bookings for 10 tickets → exactly 10 succeed", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, { quantity: 10 });
    const buyers = await Promise.all(
      Array.from({ length: 4 }, (_, i) => buyer(`b${i}@example.com`)),
    );
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        book(buyers[i % 4]!.token, { eventId, items: [{ ticketTypeId, quantity: 1 }] }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(20);
    expect(results.find((r) => r.status === 409)!.body.code).toBe("TICKET_SOLD_OUT");
    expect(await stock(ticketTypeId)).toMatchObject({ quantityReserved: 10, quantityTotal: 10 });
  });

  it("explains why a booking can't be made", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, {
      quantity: 5,
      maxPerOrder: 4,
    });
    const other = await publishedEvent(org.token, { title: "Other Gig" });
    const b = await buyer();
    const item = (quantity: number, id = ticketTypeId) => ({
      eventId,
      items: [{ ticketTypeId: id, quantity }],
    });

    expect((await book(b.token, item(5))).body.code).toBe("INVALID_QUANTITY"); // > maxPerOrder
    expect((await book(b.token, item(1, other.ticketTypeId))).body.code).toBe(
      "INVALID_TICKET_TYPE",
    );
    await book(b.token, item(4));
    const soldOut = await book(b.token, item(2));
    expect(soldOut.status).toBe(409);
    expect(soldOut.body).toMatchObject({ code: "TICKET_SOLD_OUT", details: { available: 1 } });
    expect(soldOut.body.title).toMatch(/Only 1 'General' tickets left/);

    // duplicates / empty / too many
    expect(
      (
        await book(b.token, {
          eventId,
          items: [
            { ticketTypeId, quantity: 1 },
            { ticketTypeId, quantity: 1 },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await book(b.token, { eventId, items: [] })).status).toBe(400);

    // sales window not open yet
    await prisma.ticketType.update({
      where: { id: other.ticketTypeId },
      data: { salesStartAt: new Date(Date.now() + 86_400_000) },
    });
    expect(
      (
        await book(b.token, {
          eventId: other.eventId,
          items: [{ ticketTypeId: other.ticketTypeId, quantity: 1 }],
        })
      ).body.code,
    ).toBe("SALES_NOT_STARTED");

    // drafts don't exist publicly; cancelled events are not on sale
    const draft = await api()
      .post("/api/v1/events")
      .set(bearer(org.token))
      .send({
        title: "Draft",
        mode: "online",
        startsAt: new Date(Date.now() + 86_400_000 * 3).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000 * 3 + 3_600_000).toISOString(),
      });
    expect(
      (
        await book(b.token, {
          eventId: draft.body.event.id,
          items: [{ ticketTypeId, quantity: 1 }],
        })
      ).status,
    ).toBe(404);
    await api()
      .post(`/api/v1/events/${eventId}/cancel`)
      .set(bearer(org.token))
      .send({ reason: "Storm" });
    expect((await book(b.token, item(1))).body.code).toBe("EVENT_NOT_ON_SALE");
  });
});

describe("free bookings", () => {
  it("are confirmed immediately with tickets, sold counters and a confirmation email", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, { price: 0 });
    const b = await buyer();

    const res = await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 3 }] });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      status: "confirmed",
      totalAmount: 0,
      expiresAt: null,
    });
    expect(res.body.booking.tickets).toHaveLength(3);
    for (const t of res.body.booking.tickets) {
      expect(t).toMatchObject({ status: "valid", ticketType: "General" });
      expect(t.ticketCode).toMatch(/^TKT-[0-9A-Z]{16}$/);
    }
    expect(
      new Set(res.body.booking.tickets.map((t: { ticketCode: string }) => t.ticketCode)).size,
    ).toBe(3);
    expect(await stock(ticketTypeId)).toMatchObject({ quantityReserved: 0, quantitySold: 3 });

    const mail = await prisma.notification.findFirstOrThrow({
      where: { type: "booking.confirmed" },
    });
    expect(mail.payload).toMatchObject({
      ticketCount: 3,
      bookingCode: res.body.booking.bookingCode,
    });
  });

  it("confirming twice is a no-op (safe for payment webhooks racing the verify call)", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, { price: 0 });
    const b = await buyer();
    const res = await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 2 }] });
    expect(await prisma.$transaction((tx) => confirmInTx(tx, res.body.booking.id))).toBeNull();
    expect(await prisma.ticket.count()).toBe(2);
    expect(await stock(ticketTypeId)).toMatchObject({ quantitySold: 2 });
  });
});

describe("cancel / expire", () => {
  it("the buyer cancels a pending booking and the stock is released", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token);
    const b = await buyer();
    const other = await buyer("other@example.com");
    const id = (await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 4 }] })).body
      .booking.id;

    expect(
      (await api().post(`/api/v1/bookings/${id}/cancel`).set(bearer(other.token))).status,
    ).toBe(404);
    const res = await api().post(`/api/v1/bookings/${id}/cancel`).set(bearer(b.token));
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe("cancelled");
    expect(await stock(ticketTypeId)).toMatchObject({ quantityReserved: 0 });

    const again = await api().post(`/api/v1/bookings/${id}/cancel`).set(bearer(b.token));
    expect(again.body.code).toBe("BOOKING_NOT_CANCELLABLE");
  });

  it("confirmed bookings can't be cancelled here", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, { price: 0 });
    const b = await buyer();
    const id = (await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 1 }] })).body
      .booking.id;
    const res = await api().post(`/api/v1/bookings/${id}/cancel`).set(bearer(b.token));
    expect(res.status).toBe(409);
    expect(res.body.title).toMatch(/refund/);
  });

  it("holds expire only after the deadline (delayed job + sweep)", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token);
    const b = await buyer();
    const id = (await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 2 }] })).body
      .booking.id;

    expect(await expire(id)).toBe(false); // not due yet
    await prisma.$executeRaw`UPDATE bookings SET created_at = now() - interval '20 minutes', expires_at = now() - interval '1 minute' WHERE id = ${id}::uuid`;
    expect(await sweepExpired()).toBe(1);
    expect(await expire(id)).toBe(false); // already expired: idempotent

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(booking.status).toBe("expired");
    expect(await stock(ticketTypeId)).toMatchObject({ quantityReserved: 0 });
  });
});

describe("read bookings", () => {
  it("buyer and the event's organizer can read it; others can't", async () => {
    const org = await makeOrganizer();
    const otherOrg = await makeOrganizer("other-org@example.com");
    const { eventId, ticketTypeId } = await publishedEvent(org.token);
    const b = await buyer();
    const id = (await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 1 }] })).body
      .booking.id;

    const own = await api().get(`/api/v1/bookings/${id}`).set(bearer(b.token));
    expect(own.body.booking.contact).toEqual({ email: "buyer@example.com", phone: null });
    expect((await api().get(`/api/v1/bookings/${id}`).set(bearer(org.token))).status).toBe(200);
    expect((await api().get(`/api/v1/bookings/${id}`).set(bearer(otherOrg.token))).status).toBe(
      404,
    );

    await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 2 }] });
    const mine = await api().get("/api/v1/me/bookings?limit=1").set(bearer(b.token));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.page.hasMore).toBe(true);
    expect(mine.body.data[0].items[0].quantity).toBe(2); // newest first
  });
});
