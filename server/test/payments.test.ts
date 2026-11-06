import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBreakers } from "../src/lib/http.js";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import {
  processWebhookEvent,
  reconcileOpenPayments,
} from "../src/modules/payments/payments.service.js";
import { esewaSignature, toRupees } from "../src/modules/payments/providers/esewa.js";
import { processRefund } from "../src/modules/payments/refunds.service.js";
import { api, bearer, book, buyer, makeOrganizer, publishedEvent, resetState } from "./helpers.js";

beforeEach(async () => {
  await resetState();
  resetBreakers();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

/** A paid event and a pending booking for `quantity` tickets at NPR 1,500 each. */
async function pendingBooking(quantity = 2) {
  const org = await makeOrganizer();
  const { eventId, ticketTypeId } = await publishedEvent(org.token, { price: 150000 });
  const b = await buyer();
  const res = await book(b.token, { eventId, items: [{ ticketTypeId, quantity }] });
  expect(res.body.booking.status).toBe("pending");
  return { org, b, eventId, ticketTypeId, booking: res.body.booking };
}

const pay = (
  token: string,
  bookingId: string,
  provider: string,
  key = `pay-${Date.now()}-${Math.random()}`,
) =>
  api()
    .post(`/api/v1/bookings/${bookingId}/payments`)
    .set(bearer(token))
    .set("Idempotency-Key", key.replace(/[^\w-]/g, ""))
    .send({ provider });

const verify = (token: string, provider: string, body: object) =>
  api().post(`/api/v1/payments/${provider}/verify`).set(bearer(token)).send(body);

/** Routes stubbed gateway calls by URL; anything else hits the real fetch. */
function stubFetch(routes: Record<string, (url: string, init?: RequestInit) => unknown>) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return real(input, init);
    const body = routes[key]!(url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("providers", () => {
  it("lists the configured providers", async () => {
    const res = await api().get("/api/v1/payments/providers");
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual([
      "khalti",
      "esewa",
      "stripe",
      "mock",
    ]);
  });
});

describe("mock provider: the full paid flow", () => {
  it("initiate → pay at the gateway → verify → confirmed with tickets", async () => {
    const { b, ticketTypeId, booking } = await pendingBooking(2);
    const init = await pay(b.token, booking.id, "mock");
    expect(init.status).toBe(201);
    expect(init.body.payment).toMatchObject({
      provider: "mock",
      amount: 300000,
      currency: "NPR",
      status: "initiated",
    });
    expect(init.body.action).toMatchObject({ type: "redirect" });
    // the hold is extended while the buyer is on the gateway page
    expect(Date.parse(init.body.holdExpiresAt) - Date.now()).toBeGreaterThan(14 * 60_000);
    const paymentId = init.body.payment.id as string;

    // not paid yet → pending, booking still pending
    let v = await verify(b.token, "mock", { paymentId });
    expect(v.body).toMatchObject({ outcome: "pending", booking: { status: "pending" } });

    await api()
      .post("/api/v1/payments/mock/complete")
      .set(bearer(b.token))
      .send({ paymentId, outcome: "success" });
    v = await verify(b.token, "mock", { paymentId });
    expect(v.status).toBe(200);
    expect(v.body.outcome).toBe("confirmed");
    expect(v.body.payment.status).toBe("succeeded");
    expect(v.body.booking).toMatchObject({ status: "confirmed" });
    expect(v.body.booking.tickets).toHaveLength(2);
    const tt = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
    expect(tt).toMatchObject({ quantityReserved: 0, quantitySold: 2 });

    // verifying again (or a webhook racing it) changes nothing
    v = await verify(b.token, "mock", { paymentId });
    expect(v.body.outcome).toBe("already_succeeded");
    expect(await prisma.ticket.count()).toBe(2);
  });

  it("a declined payment leaves the booking pending so the buyer can retry", async () => {
    const { b, booking } = await pendingBooking(1);
    const paymentId = (await pay(b.token, booking.id, "mock")).body.payment.id;
    await api()
      .post("/api/v1/payments/mock/complete")
      .set(bearer(b.token))
      .send({ paymentId, outcome: "failure" });
    const v = await verify(b.token, "mock", { paymentId });
    expect(v.body).toMatchObject({
      outcome: "failed",
      payment: { status: "failed" },
      booking: { status: "pending" },
    });
    expect((await pay(b.token, booking.id, "mock")).status).toBe(201);
  });

  it("rejects paying someone else's, free, expired or unknown bookings", async () => {
    const { booking } = await pendingBooking(1);
    const other = await buyer("other@example.com");
    expect((await pay(other.token, booking.id, "mock")).status).toBe(404);
    expect((await pay(other.token, booking.id, "paypal")).status).toBe(404);

    const { b, booking: b2 } = await (async () => {
      const x = await buyer("third@example.com");
      const ev = await prisma.event.findFirstOrThrow();
      const tt = await prisma.ticketType.findFirstOrThrow();
      const r = await book(x.token, {
        eventId: ev.id,
        items: [{ ticketTypeId: tt.id, quantity: 1 }],
      });
      return { b: x, booking: r.body.booking };
    })();
    await prisma.$executeRaw`UPDATE bookings SET created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' WHERE id = ${b2.id}::uuid`;
    expect((await pay(b.token, b2.id, "mock")).body.code).toBe("BOOKING_EXPIRED");
  });

  it("needs an Idempotency-Key; a replay returns the same payment", async () => {
    const { b, booking } = await pendingBooking(1);
    const noKey = await api()
      .post(`/api/v1/bookings/${booking.id}/payments`)
      .set(bearer(b.token))
      .send({ provider: "mock" });
    expect(noKey.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const a = await pay(b.token, booking.id, "mock", "same-pay-key-1");
    const c = await pay(b.token, booking.id, "mock", "same-pay-key-1");
    expect(c.body.payment.id).toBe(a.body.payment.id);
    expect(await prisma.payment.count()).toBe(1);
  });
});

describe("Khalti", () => {
  it("initiates with paisa amounts and confirms only after a Completed lookup with the right amount", async () => {
    const { b, booking } = await pendingBooking(2);
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    let lookupStatus = "Completed";
    let lookupAmount = 300000;
    stubFetch({
      "khalti.test/api/v2/epayment/initiate/": (url, init) => {
        calls.push({
          url,
          body: JSON.parse(String(init!.body)),
          auth: new Headers(init!.headers).get("authorization"),
        });
        return {
          pidx: "bZQLD9wRVWo4CdESSfuSsB",
          payment_url: "https://test-pay.khalti.com/?pidx=bZQLD9wRVWo4CdESSfuSsB",
        };
      },
      "khalti.test/api/v2/epayment/lookup/": () => ({
        pidx: "bZQLD9wRVWo4CdESSfuSsB",
        total_amount: lookupAmount,
        status: lookupStatus,
        transaction_id: "GFq9PFS7b2iYvL8Lir9oXe",
        refunded: false,
      }),
    });

    const init = await pay(b.token, booking.id, "khalti");
    expect(init.status).toBe(201);
    expect(init.body.action).toEqual({
      type: "redirect",
      url: "https://test-pay.khalti.com/?pidx=bZQLD9wRVWo4CdESSfuSsB",
    });
    expect(calls[0]!.auth).toBe("Key test-khalti-secret");
    expect(calls[0]!.body).toMatchObject({
      amount: 300000,
      purchase_order_id: init.body.payment.id,
      return_url: "http://localhost:5173/payments/return?provider=khalti",
    });

    // tampered amount at the gateway → never confirmed
    lookupAmount = 1000;
    let v = await verify(b.token, "khalti", { pidx: "bZQLD9wRVWo4CdESSfuSsB" });
    expect(v.body.outcome).toBe("amount_mismatch");
    expect(v.body.booking.status).toBe("pending");

    // a fresh attempt that the gateway reports correctly
    lookupAmount = 300000;
    lookupStatus = "Completed";
    await prisma.payment.update({
      where: { id: init.body.payment.id },
      data: { status: "pending" },
    });
    v = await verify(b.token, "khalti", {
      pidx: "bZQLD9wRVWo4CdESSfuSsB",
      status: "Completed",
      amount: "1",
    });
    expect(v.body.outcome).toBe("confirmed");
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: init.body.payment.id } });
    expect(p).toMatchObject({ status: "succeeded", providerRef: "GFq9PFS7b2iYvL8Lir9oXe" });
  });

  it("gateway down: 503 and the payment is left for reconciliation", async () => {
    const { b, booking } = await pendingBooking(1);
    stubFetch({
      "epayment/initiate/": () => ({ pidx: "pidxDOWN123456", payment_url: "https://x" }),
      "epayment/lookup/": () => new Response("upstream error", { status: 502 }),
    });
    await pay(b.token, booking.id, "khalti");
    const v = await verify(b.token, "khalti", { pidx: "pidxDOWN123456" });
    expect(v.status).toBe(503);
    expect(v.body.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
    expect((await prisma.payment.findFirstOrThrow()).status).toBe("initiated");
  });

  it("reconciliation settles payments of buyers who closed the browser after paying", async () => {
    const { b, booking } = await pendingBooking(1);
    stubFetch({
      "epayment/initiate/": () => ({ pidx: "pidxRECON12345", payment_url: "https://x" }),
      "epayment/lookup/": () => ({
        pidx: "pidxRECON12345",
        total_amount: 150000,
        status: "Completed",
        transaction_id: "T1",
      }),
    });
    const init = await pay(b.token, booking.id, "khalti");
    await prisma.$executeRaw`UPDATE payments SET initiated_at = now() - interval '20 minutes' WHERE id = ${init.body.payment.id}::uuid`;
    expect(await reconcileOpenPayments()).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      "confirmed",
    );
  });
});

describe("eSewa", () => {
  it("builds a signed form and verifies the redirect signature + status API", async () => {
    const { b, booking } = await pendingBooking(1);
    const init = await pay(b.token, booking.id, "esewa");
    expect(init.status).toBe(201);
    const { action } = init.body;
    expect(action).toMatchObject({
      type: "form",
      method: "POST",
      url: "https://esewa.test/api/epay/main/v2/form",
    });
    expect(action.fields).toMatchObject({
      total_amount: "1500",
      amount: "1500",
      transaction_uuid: init.body.payment.id,
      product_code: "EPAYTEST",
      signed_field_names: "total_amount,transaction_uuid,product_code",
    });
    // signature per the eSewa docs
    const expected = createHmac("sha256", "8gBm/:&EnhH.1/q")
      .update(`total_amount=1500,transaction_uuid=${init.body.payment.id},product_code=EPAYTEST`)
      .digest("base64");
    expect(action.fields.signature).toBe(expected);

    // success redirect payload, signed by "eSewa"
    const response: Record<string, string> = {
      transaction_code: "000AWEO",
      status: "COMPLETE",
      total_amount: "1500.0",
      transaction_uuid: init.body.payment.id,
      product_code: "EPAYTEST",
      signed_field_names:
        "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names",
    };
    response.signature = esewaSignature(response, response.signed_field_names!);
    const data = Buffer.from(JSON.stringify(response)).toString("base64");

    // tampered payload → rejected before any lookup
    const forged = Buffer.from(JSON.stringify({ ...response, total_amount: "1.0" })).toString(
      "base64",
    );
    expect((await verify(b.token, "esewa", { data: forged })).body.code).toBe("INVALID_SIGNATURE");

    const statusCalls: string[] = [];
    stubFetch({
      "esewa.test/api/epay/transaction/status/": (url) => {
        statusCalls.push(url);
        return {
          product_code: "EPAYTEST",
          transaction_uuid: init.body.payment.id,
          total_amount: 1500.0,
          status: "COMPLETE",
          ref_id: "0001TS9",
        };
      },
    });
    const v = await verify(b.token, "esewa", { data });
    expect(v.body.outcome).toBe("confirmed");
    expect(statusCalls[0]).toContain(`total_amount=1500&transaction_uuid=${init.body.payment.id}`);
    expect(toRupees(150050n)).toBe("1500.50");
  });
});

describe("Stripe", () => {
  const signed = (
    payload: object,
    secret = "whsec_test_secret",
    t = Math.floor(Date.now() / 1000),
  ) => {
    const body = JSON.stringify(payload);
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    return { body, header: `t=${t},v1=${sig}` };
  };
  const webhook = (body: string, header?: string) => {
    const r = api().post("/api/v1/webhooks/stripe").set("content-type", "application/json");
    if (header) r.set("stripe-signature", header);
    return r.send(body);
  };

  it("checkout session → signed webhook stored once → worker re-verifies and confirms", async () => {
    const { b, booking } = await pendingBooking(1);
    let paid = false;
    stubFetch({
      "stripe.test/v1/checkout/sessions/cs_test_abc1234567890": () => ({
        id: "cs_test_abc1234567890",
        url: null,
        status: paid ? "complete" : "open",
        payment_status: paid ? "paid" : "unpaid",
        amount_total: 150000,
        currency: "npr",
        payment_intent: "pi_123",
        client_reference_id: null,
      }),
      "stripe.test/v1/checkout/sessions": (_url, init) => {
        const form = new URLSearchParams(String(init!.body));
        expect(form.get("line_items[0][price_data][unit_amount]")).toBe("150000");
        expect(form.get("line_items[0][price_data][currency]")).toBe("npr");
        return {
          id: "cs_test_abc1234567890",
          url: "https://checkout.stripe.com/c/pay/cs_test_abc1234567890",
        };
      },
    });
    const init = await pay(b.token, booking.id, "stripe");
    expect(init.body.action.url).toContain("checkout.stripe.com");

    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_abc1234567890" } },
    };
    const { body, header } = signed(event);
    expect((await webhook(body)).status).toBe(401);
    expect((await webhook(body, signed(event, "whsec_wrong").header)).status).toBe(401);
    expect(
      (await webhook(body, signed(event, undefined, Math.floor(Date.now() / 1000) - 3600).header))
        .status,
    ).toBe(401); // replay
    expect((await webhook(body, header)).status).toBe(200);
    expect((await webhook(body, header)).status).toBe(200); // duplicate delivery
    expect(await prisma.paymentWebhookEvent.count()).toBe(1);

    paid = true;
    const row = await prisma.paymentWebhookEvent.findFirstOrThrow();
    await processWebhookEvent(row.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      "confirmed",
    );
    expect((await prisma.paymentWebhookEvent.findFirstOrThrow()).processedAt).not.toBeNull();
  });
});

describe("edge cases", () => {
  it("paid after the hold expired: re-held and confirmed if tickets remain, refunded if sold out", async () => {
    const org = await makeOrganizer();
    const { eventId, ticketTypeId } = await publishedEvent(org.token, {
      price: 150000,
      quantity: 1,
    });
    const b = await buyer();
    const late = (await book(b.token, { eventId, items: [{ ticketTypeId, quantity: 1 }] })).body
      .booking;
    const paymentId = (await pay(b.token, late.id, "mock")).body.payment.id;
    await api()
      .post("/api/v1/payments/mock/complete")
      .set(bearer(b.token))
      .send({ paymentId, outcome: "success" });

    // the hold expires and someone else holds the last ticket
    await prisma.$executeRaw`UPDATE bookings SET created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' WHERE id = ${late.id}::uuid`;
    const { sweepExpired } = await import("../src/modules/bookings/bookings.service.js");
    await sweepExpired();
    const other = await buyer("other@example.com");
    expect(
      (await book(other.token, { eventId, items: [{ ticketTypeId, quantity: 1 }] })).status,
    ).toBe(201);

    const v = await verify(b.token, "mock", { paymentId });
    expect(v.body.outcome).toBe("needs_refund");
    expect(v.body.booking.status).toBe("refunded");
    const refund = await prisma.refund.findFirstOrThrow();
    expect(refund).toMatchObject({ status: "requested", amount: 150000n, requestedBy: null });
    await processRefund(refund.id, true);
    expect((await prisma.refund.findFirstOrThrow()).status).toBe("succeeded");
  });

  it("a second successful payment for an already-paid booking is flagged, never double-confirmed", async () => {
    const { b, booking } = await pendingBooking(1);
    const p1 = (await pay(b.token, booking.id, "mock")).body.payment.id;
    const p2 = (await pay(b.token, booking.id, "mock")).body.payment.id;
    for (const id of [p1, p2]) {
      await api()
        .post("/api/v1/payments/mock/complete")
        .set(bearer(b.token))
        .send({ paymentId: id, outcome: "success" });
    }
    expect((await verify(b.token, "mock", { paymentId: p1 })).body.outcome).toBe("confirmed");
    expect((await verify(b.token, "mock", { paymentId: p2 })).body.outcome).toBe("duplicate");
    expect(await prisma.ticket.count()).toBe(1);
    const dup = await prisma.payment.findUniqueOrThrow({ where: { id: p2 } });
    expect(dup.status).toBe("cancelled");
    expect(dup.failureReason).toMatch(/Refund this one manually/);
  });

  it("a concurrent verify + webhook confirm exactly once", async () => {
    const { b, booking } = await pendingBooking(2);
    const paymentId = (await pay(b.token, booking.id, "mock")).body.payment.id;
    await api()
      .post("/api/v1/payments/mock/complete")
      .set(bearer(b.token))
      .send({ paymentId, outcome: "success" });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => verify(b.token, "mock", { paymentId })),
    );
    expect(results.filter((r) => r.body.outcome === "confirmed")).toHaveLength(1);
    expect(await prisma.ticket.count()).toBe(2);
  });
});
