import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import { ensureBucket } from "../src/lib/storage.js";
import { fanoutEventCancellation, processRefund } from "../src/modules/payments/refunds.service.js";
import { csvField, processExport } from "../src/modules/tickets/attendees.service.js";
import {
  api,
  bearer,
  book,
  buyer,
  makeAdmin,
  makeOrganizer,
  publishedEvent,
  resetState,
} from "./helpers.js";

beforeAll(ensureBucket);
beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

/** Organizer + paid event + buyer with a confirmed (mock-paid) booking. */
async function paidBooking(quantity = 2, opts: { provider?: "mock" | "esewa" } = {}) {
  const org = await makeOrganizer();
  const { eventId, ticketTypeId } = await publishedEvent(org.token, { price: 100000 });
  const b = await buyer();
  const booking = (await book(b.token, { eventId, items: [{ ticketTypeId, quantity }] })).body
    .booking;
  const provider = opts.provider ?? "mock";
  const init = await api()
    .post(`/api/v1/bookings/${booking.id}/payments`)
    .set(bearer(b.token))
    .set("Idempotency-Key", `pay-${booking.id}`)
    .send({ provider: "mock" });
  const paymentId = init.body.payment.id as string;
  await api()
    .post("/api/v1/payments/mock/complete")
    .set(bearer(b.token))
    .send({ paymentId, outcome: "success" });
  const v = await api()
    .post("/api/v1/payments/mock/verify")
    .set(bearer(b.token))
    .send({ paymentId });
  expect(v.body.booking.status).toBe("confirmed");
  if (provider === "esewa") {
    await prisma.payment.update({ where: { id: paymentId }, data: { provider: "esewa" } });
  }
  return { org, b, eventId, ticketTypeId, booking: v.body.booking, paymentId };
}

const refund = (token: string, bookingId: string, reason = "Can't make it", key?: string) =>
  api()
    .post(`/api/v1/bookings/${bookingId}/refunds`)
    .set(bearer(token))
    .set("Idempotency-Key", key ?? `refund-${bookingId}-${token.slice(-6)}`)
    .send({ reason });

describe("refunds", () => {
  it("buyer refund: tickets voided, stock back on sale, money returned by the worker", async () => {
    const { b, ticketTypeId, booking } = await paidBooking(2);
    const res = await refund(b.token, booking.id);
    expect(res.status).toBe(202);
    expect(res.body.refund).toMatchObject({ status: "requested", amount: 200000 });

    const after = await api().get(`/api/v1/bookings/${booking.id}`).set(bearer(b.token));
    expect(after.body.booking).toMatchObject({
      status: "refunded",
      refund: { status: "requested" },
    });
    expect(
      after.body.booking.tickets.every((t: { status: string }) => t.status === "refunded"),
    ).toBe(true);
    expect(
      await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } }),
    ).toMatchObject({ quantitySold: 0 });
    expect(await prisma.notification.count({ where: { type: "booking.refunded" } })).toBe(1);

    await processRefund(res.body.refund.id, false);
    const r = await prisma.refund.findUniqueOrThrow({
      where: { id: res.body.refund.id },
      include: { payment: true },
    });
    expect(r).toMatchObject({
      status: "succeeded",
      providerRefundId: expect.stringMatching(/^mock_rf_/),
    });
    expect(r.payment!.status).toBe("refunded");

    // asking again returns the same refund
    const again = await refund(b.token, booking.id, "again please", "a-different-key-1");
    expect(again.status).toBe(200);
    expect(again.body.refund.id).toBe(res.body.refund.id);
  });

  it("buyers can't refund close to the event or after using a ticket; organizers/admins can", async () => {
    const { org, b, eventId, booking } = await paidBooking(1);
    await prisma.event.update({
      where: { id: eventId },
      data: {
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 7_200_000),
      },
    });
    expect((await refund(b.token, booking.id)).body.code).toBe("REFUND_WINDOW_CLOSED");
    const stranger = await buyer("stranger@example.com");
    expect((await refund(stranger.token, booking.id)).status).toBe(404);
    expect((await refund(org.token, booking.id, "Organizer goodwill")).status).toBe(202);
  });

  it("checked-in tickets block organizer refunds; admins may still refund", async () => {
    const { org, booking, eventId } = await paidBooking(1);
    await api()
      .post(`/api/v1/events/${eventId}/check-ins`)
      .set(bearer(org.token))
      .send({ ticketCode: booking.tickets[0].ticketCode });
    expect((await refund(org.token, booking.id)).body.code).toBe("TICKETS_ALREADY_USED");
    const admin = await makeAdmin();
    expect((await refund(admin, booking.id, "Admin override")).status).toBe(202);
  });

  it("eSewa has no refund API: refund is marked manual, then completed by an admin", async () => {
    const { b, booking } = await paidBooking(1, { provider: "esewa" });
    const r = (await refund(b.token, booking.id)).body.refund;
    await processRefund(r.id, false);
    let row = await prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: "processing", manual: true });

    const admin = await makeAdmin();
    const pending = await api().get("/api/v1/admin/refunds?manual=true").set(bearer(admin));
    expect(pending.body.data).toHaveLength(1);
    const done = await api()
      .post(`/api/v1/admin/refunds/${r.id}/complete`)
      .set(bearer(admin))
      .send({ providerRefundId: "ESEWA-REF-42" });
    expect(done.body.refund.status).toBe("succeeded");
    row = await prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.providerRefundId).toBe("ESEWA-REF-42");
  });

  it("a refund that keeps failing ends as failed and can be retried by an admin", async () => {
    const { b, booking, paymentId } = await paidBooking(1);
    await prisma.payment.update({
      where: { id: paymentId },
      data: { provider: "khalti", providerRef: null },
    });
    const r = (await refund(b.token, booking.id)).body.refund;
    await expect(processRefund(r.id, true)).rejects.toThrow(/transaction_id/);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("failed");
    const admin = await makeAdmin();
    const retried = await api().post(`/api/v1/admin/refunds/${r.id}/retry`).set(bearer(admin));
    expect(retried.body.refund.status).toBe("requested");
  });
});

describe("event cancellation fan-out", () => {
  it("refunds paid bookings, cancels free ones, releases holds", async () => {
    const { org, eventId, ticketTypeId, booking } = await paidBooking(2);
    // a second buyer holding unpaid tickets
    const holder = await buyer("holder@example.com");
    const pending = (await book(holder.token, { eventId, items: [{ ticketTypeId, quantity: 3 }] }))
      .body.booking;

    const res = await api()
      .post(`/api/v1/events/${eventId}/cancel`)
      .set(bearer(org.token))
      .send({ reason: "Venue flooded" });
    expect(res.status).toBe(202);
    expect(await fanoutEventCancellation(eventId)).toBe(2);
    expect(await fanoutEventCancellation(eventId)).toBe(0); // idempotent

    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      "refunded",
    );
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      "cancelled",
    );
    const refundRow = await prisma.refund.findFirstOrThrow();
    expect(refundRow.reason).toBe("Event cancelled: Venue flooded");
    expect(
      await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } }),
    ).toMatchObject({
      quantitySold: 0,
      quantityReserved: 0,
    });

    const view = await api().get(`/api/v1/events/${eventId}`).set(bearer(org.token));
    expect(view.body.event.refundProgress).toEqual({ remaining: 0, refunded: 1, cancelled: 1 });
  });
});

describe("promo codes", () => {
  it("organizer creates codes; buyers validate and get the discount at booking", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, { price: 100000 });
    const base = `/api/v1/events/${eventId}/promo-codes`;

    const pct = await api()
      .post(base)
      .set(bearer(org.token))
      .send({ code: "early20", discountType: "percent", discountValue: 20, maxRedemptions: 1 });
    expect(pct.status).toBe(201);
    expect(pct.body.promoCode).toMatchObject({ code: "EARLY20", remaining: 1 });
    expect(
      (
        await api()
          .post(base)
          .set(bearer(org.token))
          .send({ code: "EARLY20", discountType: "fixed", discountValue: 1 })
      ).body.code,
    ).toBe("PROMO_CODE_EXISTS");
    expect(
      (
        await api()
          .post(base)
          .set(bearer(org.token))
          .send({ code: "BAD", discountType: "percent", discountValue: 150 })
      ).status,
    ).toBe(400);
    const other = await makeOrganizer("other@example.com");
    expect((await api().get(base).set(bearer(other.token))).status).toBe(404);

    const b = await buyer();
    const check = await api()
      .post("/api/v1/promo-codes/validate")
      .set(bearer(b.token))
      .send({ eventId, code: "early20", items: [{ ticketTypeId, quantity: 3 }] });
    expect(check.body).toMatchObject({
      valid: true,
      preview: { subtotal: 300000, discountAmount: 60000, total: 240000 },
    });
    expect(
      (
        await api()
          .post("/api/v1/promo-codes/validate")
          .set(bearer(b.token))
          .send({ eventId, code: "NOPE" })
      ).body.code,
    ).toBe("PROMO_CODE_INVALID");

    const res = await book(b.token, {
      eventId,
      items: [{ ticketTypeId, quantity: 3 }],
      promoCode: "Early20",
    });
    expect(res.body.booking).toMatchObject({
      subtotal: 300000,
      discountAmount: 60000,
      totalAmount: 240000,
      promoCode: "EARLY20",
    });

    // single-use: the next buyer is told it's used up
    const b2 = await buyer("b2@example.com");
    const used = await book(b2.token, {
      eventId,
      items: [{ ticketTypeId, quantity: 1 }],
      promoCode: "EARLY20",
    });
    expect(used.body.code).toBe("PROMO_CODE_EXHAUSTED");

    // cancelling the booking gives the redemption back
    await api().post(`/api/v1/bookings/${res.body.booking.id}/cancel`).set(bearer(b.token));
    expect(
      (
        await book(b2.token, {
          eventId,
          items: [{ ticketTypeId, quantity: 1 }],
          promoCode: "EARLY20",
        })
      ).status,
    ).toBe(201);
    expect(
      (await api().delete(`${base}/${pct.body.promoCode.id}`).set(bearer(org.token))).body.code,
    ).toBe("PROMO_CODE_USED");
  });

  it("a 100% code makes the booking free and confirms it instantly", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, { price: 50000 });
    await api()
      .post(`/api/v1/events/${eventId}/promo-codes`)
      .set(bearer(org.token))
      .send({ code: "GUEST", discountType: "percent", discountValue: 100 });
    const b = await buyer();
    const res = await book(b.token, {
      eventId,
      items: [{ ticketTypeId, quantity: 2 }],
      promoCode: "guest",
    });
    expect(res.body.booking).toMatchObject({
      status: "confirmed",
      totalAmount: 0,
      discountAmount: 100000,
    });
    expect(res.body.booking.tickets).toHaveLength(2);
  });

  it("expired and not-yet-valid codes are rejected with a clear reason", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token);
    const base = `/api/v1/events/${eventId}/promo-codes`;
    const day = 86_400_000;
    await api()
      .post(base)
      .set(bearer(org.token))
      .send({
        code: "SOON",
        discountType: "fixed",
        discountValue: 1000,
        validFrom: new Date(Date.now() + day).toISOString(),
      });
    const old = await api()
      .post(base)
      .set(bearer(org.token))
      .send({ code: "OLD", discountType: "fixed", discountValue: 1000 });
    await prisma.promoCode.update({
      where: { id: old.body.promoCode.id },
      data: { validUntil: new Date(Date.now() - day), validFrom: new Date(Date.now() - 2 * day) },
    });
    const b = await buyer();
    const item = { ticketTypeId, quantity: 1 };
    expect((await book(b.token, { eventId, items: [item], promoCode: "SOON" })).body.code).toBe(
      "PROMO_CODE_NOT_STARTED",
    );
    expect((await book(b.token, { eventId, items: [item], promoCode: "OLD" })).body.code).toBe(
      "PROMO_CODE_EXPIRED",
    );
  });
});

describe("attendees", () => {
  it("organizer lists and searches attendees; scanners can't", async () => {
    const { org, eventId, booking, b } = await paidBooking(2);
    await api()
      .patch(`/api/v1/tickets/${booking.tickets[0].id}/holder`)
      .set(bearer(b.token))
      .send({ holderName: "Sita Sharma", holderEmail: "sita@example.com" });

    const list = await api().get(`/api/v1/events/${eventId}/attendees`).set(bearer(org.token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.map((a: { name: string }) => a.name).sort()).toEqual([
      "Alice Test",
      "Sita Sharma",
    ]);
    expect(list.body.data[0]).toMatchObject({
      buyer: { email: "buyer@example.com" },
      price: 100000,
      status: "valid",
    });

    const search = await api()
      .get(`/api/v1/events/${eventId}/attendees?q=sita`)
      .set(bearer(org.token));
    expect(search.body.data).toHaveLength(1);

    const scanner = await buyer("scanner@example.com");
    await api()
      .post(`/api/v1/events/${eventId}/staff`)
      .set(bearer(org.token))
      .send({ email: "scanner@example.com", role: "scanner" });
    expect(
      (await api().get(`/api/v1/events/${eventId}/attendees`).set(bearer(scanner.token))).status,
    ).toBe(404);
    await api()
      .post(`/api/v1/events/${eventId}/staff`)
      .set(bearer(org.token))
      .send({ email: "scanner@example.com", role: "manager" });
    expect(
      (await api().get(`/api/v1/events/${eventId}/attendees`).set(bearer(scanner.token))).status,
    ).toBe(200);
  });

  it("CSV export: queued, written privately, downloadable via a signed link, formulas neutralised", async () => {
    const { org, eventId, booking, b } = await paidBooking(2);
    await api()
      .patch(`/api/v1/tickets/${booking.tickets[0].id}/holder`)
      .set(bearer(b.token))
      .send({ holderName: "=HYPERLINK(evil)" });

    const req = await api()
      .post(`/api/v1/events/${eventId}/attendees/export`)
      .set(bearer(org.token));
    expect(req.status).toBe(202);
    const id = req.body.export.id as string;
    expect(
      (await api().post(`/api/v1/events/${eventId}/attendees/export`).set(bearer(org.token))).body
        .code,
    ).toBe("EXPORT_IN_PROGRESS");

    await processExport(id);
    const got = await api().get(`/api/v1/exports/${id}`).set(bearer(org.token));
    expect(got.body.export).toMatchObject({ status: "ready", rowCount: 2 });
    const csv = await (await fetch(got.body.export.downloadUrl)).text();
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toMatch(/^ticket_code,ticket_type,status,name/);
    expect(csv).toContain(`"'=HYPERLINK(evil)"`);
    expect(await prisma.notification.count({ where: { type: "export.ready" } })).toBe(1);

    const stranger = await buyer("x@example.com");
    expect((await api().get(`/api/v1/exports/${id}`).set(bearer(stranger.token))).status).toBe(404);
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
  });
});

describe("admin", () => {
  it("stats, audit log and payments", async () => {
    await paidBooking(1);
    const admin = await makeAdmin();
    const stats = await api().get("/api/v1/admin/stats").set(bearer(admin));
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({
      bookings: { confirmed: 1 },
      events: { live: 1 },
      revenue: [{ currency: "NPR", amount: 100000 }],
    });

    const logs = await api()
      .get("/api/v1/admin/audit-logs?action=event.&limit=2")
      .set(bearer(admin));
    expect(logs.body.data.length).toBeGreaterThan(0);
    expect(logs.body.data.every((l: { action: string }) => l.action.startsWith("event."))).toBe(
      true,
    );
    if (logs.body.page.hasMore) {
      const next = await api()
        .get(`/api/v1/admin/audit-logs?action=event.&limit=2&cursor=${logs.body.page.nextCursor}`)
        .set(bearer(admin));
      expect(next.status).toBe(200);
    }

    const payments = await api().get("/api/v1/admin/payments?status=succeeded").set(bearer(admin));
    expect(payments.body.data).toHaveLength(1);
    const plain = await buyer("plain@example.com");
    expect((await api().get("/api/v1/admin/stats").set(bearer(plain.token))).status).toBe(403);
  });
});

describe("metrics and worker schedules", () => {
  it("/metrics requires the token and exposes business metrics", async () => {
    expect((await api().get("/metrics")).status).toBe(404);
    await paidBooking(1);
    const res = await api().get("/metrics").set("Authorization", "Bearer test-metrics-token-123");
    expect(res.status).toBe(200);
    expect(res.text).toContain("http_request_duration_seconds_bucket");
    expect(res.text).toMatch(/bookings_confirmed_total\{[^}]*\} [1-9]/);
    expect(res.text).toMatch(/route="\/api\/v1\/bookings\/:id\/payments"/);
  });

  it("every maintenance handler in the worker is actually scheduled", () => {
    const src = readFileSync("src/worker.ts", "utf8");
    const handlers = [...src.matchAll(/^\s+"([a-z-]+)": \(\) =>/gm)].map((m) => m[1]);
    const scheduled = [...src.matchAll(/upsertJobScheduler\(\s*"([a-z-]+)"/g)].map((m) => m[1]);
    expect(handlers.length).toBeGreaterThan(5);
    expect(scheduled.sort()).toEqual(handlers.sort());
  });
});
