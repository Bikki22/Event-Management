import { env } from "../../config/env.js";
import type { Payment, Prisma } from "../../generated/prisma/client.js";
import {
  AppError,
  Conflict,
  NotFound,
  ServiceUnavailable,
  Unprocessable,
} from "../../lib/errors.js";
import { GatewayError } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import { paymentsVerified } from "../../lib/metrics.js";
import { prisma } from "../../lib/prisma.js";
import { getQueue } from "../../lib/queue.js";
import type { AuthContext } from "../../middleware/auth.js";
import { fullBookingInclude, toBookingDto, type FullBooking } from "../bookings/bookings.dto.js";
import {
  afterConfirm,
  confirmInTx,
  reholdInTx,
  type Confirmation,
} from "../bookings/bookings.service.js";
import { enabledProviders, getProvider, providerFor } from "./providers/index.js";
import { verifyStripeSignature } from "./providers/stripe.js";
import type { LookupResult, ProviderName } from "./providers/types.js";
import { requestRefund, SYSTEM } from "./refunds.service.js";

const log = logger.child({ module: "payments" });
const TX_OPTS = { maxWait: 2_000, timeout: 5_000 } as const;
const GATEWAY_GRACE_MS = 15 * 60_000;
const returnUrl = () =>
  env.PAYMENT_RETURN_URL ?? new URL("/payments/return", env.FRONTEND_URL).toString();

export interface PaymentJobData {
  kind: "webhook" | "reconcile";
  id: string; // webhook event id or payment id
}

export const toPaymentDto = (p: Payment) => ({
  id: p.id,
  bookingId: p.bookingId,
  provider: p.provider,
  amount: Number(p.amount),
  currency: p.currency,
  status: p.status,
  failureReason: p.failureReason,
  initiatedAt: p.initiatedAt.toISOString(),
  completedAt: p.completedAt?.toISOString() ?? null,
});

export const listProviders = () =>
  enabledProviders().map((p) => ({ name: p.name, currencies: p.currencies }));

const gatewayDown = (provider: string) =>
  ServiceUnavailable(
    "PAYMENT_PROVIDER_UNAVAILABLE",
    `${provider} isn't responding right now. If you already paid, it will be confirmed automatically.`,
  );

// ───────────── initiate ─────────────

/** POST /bookings/{id}/payments: create a payment attempt and get the gateway checkout action. */
export async function initiate(auth: AuthContext, bookingId: string, providerName: string) {
  const provider = getProvider(providerName);
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { event: true, user: true },
  });
  if (!booking || booking.userId !== auth.userId) throw NotFound("Booking");
  if (booking.status !== "pending") {
    throw Conflict("BOOKING_NOT_PAYABLE", `This booking is ${booking.status}`);
  }
  if (booking.expiresAt.getTime() <= Date.now() + 15_000) {
    throw Conflict("BOOKING_EXPIRED", "This booking's hold has expired; please book again");
  }
  if (booking.totalAmount === 0n) throw Conflict("NOTHING_TO_PAY", "This booking is free");
  if (!provider.currencies.includes(booking.currency)) {
    throw Unprocessable(
      "CURRENCY_NOT_SUPPORTED",
      `${provider.name} doesn't accept ${booking.currency}`,
    );
  }

  const payment = await prisma.payment.create({
    data: {
      bookingId,
      provider: provider.name,
      amount: booking.totalAmount,
      currency: booking.currency,
    },
  });
  // gateway pages take a while: keep the tickets held at least 15 more minutes
  const holdUntil = new Date(Date.now() + GATEWAY_GRACE_MS);
  await prisma.booking.updateMany({
    where: { id: bookingId, status: "pending", expiresAt: { lt: holdUntil } },
    data: { expiresAt: holdUntil },
  });

  let result;
  try {
    result = await provider.initiate({
      payment,
      booking,
      event: booking.event,
      user: booking.user,
      returnUrl: returnUrl(),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "initiate failed";
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "failed", failureReason: reason },
    });
    if (err instanceof GatewayError && err.status !== undefined && err.status < 500) {
      log.warn({ err, paymentId: payment.id }, "gateway rejected initiate");
      throw new AppError(
        422,
        "PAYMENT_REJECTED_BY_PROVIDER",
        `${provider.name} rejected the payment request`,
        {
          provider: err.body,
        },
      );
    }
    log.error({ err, paymentId: payment.id }, "gateway initiate failed");
    throw gatewayDown(provider.name);
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerTxnId: result.providerTxnId ?? null,
      providerPayload: (result.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  log.info({ paymentId: payment.id, bookingId, provider: provider.name }, "payment.initiated");
  return {
    payment: toPaymentDto({ ...payment, providerTxnId: result.providerTxnId ?? null }),
    holdExpiresAt: holdUntil.toISOString(),
    action: result.action,
  };
}

// ───────────── settle (shared by verify, webhook and reconcile) ─────────────

type Outcome =
  | { kind: "confirmed"; confirmation: Confirmation | null }
  | { kind: "already_succeeded" | "pending" | "failed" | "amount_mismatch" | "duplicate" }
  | { kind: "needs_refund"; bookingId: string };

/**
 * Applies the gateway's server-side lookup to one payment. Idempotent and race-safe:
 * the payment row is locked, and a partial unique index allows only one succeeded payment
 * per booking, so a verify call and a webhook arriving together confirm exactly once.
 */
export async function settle(paymentId: string, lookup: LookupResult): Promise<Outcome> {
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === "succeeded") return { kind: "already_succeeded" };

    const base = {
      providerPayload: lookup.raw as Prisma.InputJsonValue,
      ...(lookup.providerRef ? { providerRef: lookup.providerRef } : {}),
      ...(lookup.providerTxnId && !p.providerTxnId ? { providerTxnId: lookup.providerTxnId } : {}),
    };

    if (lookup.status === "pending") {
      await tx.payment.update({ where: { id: p.id }, data: { status: "pending", ...base } });
      return { kind: "pending" };
    }
    if (lookup.status !== "succeeded") {
      await tx.payment.update({
        where: { id: p.id },
        data: { status: "failed", failureReason: lookup.failureReason ?? lookup.status, ...base },
      });
      return { kind: "failed" };
    }

    // never trust anything but an exact amount + currency match
    if (lookup.amount !== p.amount || (lookup.currency && lookup.currency !== p.currency)) {
      log.error(
        { paymentId, expected: p.amount.toString(), got: lookup.amount?.toString() },
        "payment amount mismatch",
      );
      await tx.payment.update({
        where: { id: p.id },
        data: {
          status: "failed",
          failureReason: `Amount mismatch: expected ${p.amount} ${p.currency}, gateway reported ${lookup.amount} ${lookup.currency ?? ""}`,
          ...base,
        },
      });
      return { kind: "amount_mismatch" };
    }

    const other = await tx.payment.findFirst({
      where: { bookingId: p.bookingId, status: "succeeded", id: { not: p.id } },
    });
    if (other) {
      // the buyer paid twice (e.g. two tabs, two providers): flag it for a manual refund
      log.error(
        { paymentId, bookingId: p.bookingId, firstPaymentId: other.id },
        "duplicate payment for a paid booking",
      );
      await tx.payment.update({
        where: { id: p.id },
        data: {
          status: "cancelled",
          completedAt: new Date(),
          failureReason: `Duplicate payment: booking already paid by ${other.id}. Refund this one manually.`,
          ...base,
        },
      });
      return { kind: "duplicate" };
    }

    await tx.payment.update({
      where: { id: p.id },
      data: { status: "succeeded", completedAt: new Date(), failureReason: null, ...base },
    });
    let confirmation = await confirmInTx(tx, p.bookingId);
    if (!confirmation) {
      const b = await tx.booking.findUniqueOrThrow({ where: { id: p.bookingId } });
      if (b.status === "confirmed") return { kind: "confirmed", confirmation: null };
      // paid after the hold expired (or after a cancel): re-hold if the tickets are still there
      if (await reholdInTx(tx, p.bookingId)) confirmation = await confirmInTx(tx, p.bookingId);
      if (!confirmation) return { kind: "needs_refund", bookingId: p.bookingId };
    }
    return { kind: "confirmed", confirmation };
  }, TX_OPTS);

  if (outcome.kind === "confirmed" && outcome.confirmation)
    await afterConfirm(outcome.confirmation);
  if (outcome.kind === "needs_refund") {
    log.warn(
      { paymentId, bookingId: outcome.bookingId },
      "paid after expiry and sold out: refunding",
    );
    await requestRefund(
      SYSTEM,
      outcome.bookingId,
      "Paid after the booking expired and the tickets were sold out",
      null,
    );
  }
  log.info({ paymentId, outcome: outcome.kind }, "payment.settled");
  return outcome;
}

// ───────────── verify (frontend, after the gateway redirect) ─────────────

async function bookingView(bookingId: string) {
  const b = (await prisma.booking.findUnique({
    where: { id: bookingId },
    include: fullBookingInclude,
  })) as FullBooking;
  return toBookingDto(b);
}

/** POST /payments/{provider}/verify: server-to-server lookup, never trusting redirect params. */
export async function verify(
  auth: AuthContext,
  providerName: string,
  body: Record<string, unknown>,
) {
  const provider = getProvider(providerName);
  const ref = provider.parseVerifyInput(body);
  const payment =
    "paymentId" in ref
      ? await prisma.payment
          .findUnique({ where: { id: ref.paymentId }, include: { booking: true } })
          .catch(() => null)
      : await prisma.payment.findUnique({
          where: {
            provider_providerTxnId: { provider: provider.name, providerTxnId: ref.providerTxnId },
          },
          include: { booking: true },
        });
  if (!payment || payment.provider !== provider.name || payment.booking.userId !== auth.userId) {
    throw NotFound("Payment");
  }

  let outcome: Outcome = { kind: "already_succeeded" };
  if (payment.status !== "succeeded") {
    let lookup: LookupResult;
    try {
      lookup = await provider.lookup(payment);
    } catch (err) {
      log.error({ err, paymentId: payment.id }, "gateway lookup failed during verify");
      await enqueueReconcile(payment.id, 60_000);
      paymentsVerified.inc({ provider: provider.name, result: "gateway_error" });
      throw gatewayDown(provider.name);
    }
    outcome = await settle(payment.id, lookup);
  }
  paymentsVerified.inc({ provider: provider.name, result: outcome.kind });

  const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  return {
    outcome: outcome.kind,
    payment: toPaymentDto(fresh),
    booking: await bookingView(payment.bookingId),
  };
}

export async function getPayment(auth: AuthContext, id: string) {
  const p = await prisma.payment
    .findUnique({ where: { id }, include: { booking: true } })
    .catch(() => null);
  if (!p || (p.booking.userId !== auth.userId && auth.role !== "admin")) throw NotFound("Payment");
  return toPaymentDto(p);
}

// ───────────── reconciliation (worker) ─────────────

export const enqueueReconcile = (paymentId: string, delay = 0) =>
  getQueue("payments")
    .add("reconcile", { kind: "reconcile", id: paymentId } satisfies PaymentJobData, {
      jobId: `reconcile-${paymentId}-${Math.floor(Date.now() / 60_000)}`,
      delay,
      attempts: 10,
      backoff: { type: "exponential", delay: 30_000 },
    })
    .catch((err: unknown) => log.warn({ err, paymentId }, "reconcile job not queued"));

/** Looks one open payment up at the gateway and settles it. Gateway errors → retried by BullMQ. */
export async function reconcilePayment(paymentId: string): Promise<string> {
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p || (p.status !== "initiated" && p.status !== "pending")) return "skipped";
  const provider = providerFor(p.provider as ProviderName);
  if (!provider) return "skipped";
  const age = Date.now() - p.initiatedAt.getTime();

  if (!p.providerTxnId && p.provider !== "esewa" && p.provider !== "mock") {
    if (age > 3_600_000) {
      await prisma.payment.update({
        where: { id: p.id },
        data: { status: "failed", failureReason: "Never reached the gateway" },
      });
      return "failed";
    }
    return "skipped";
  }
  let lookup = await provider.lookup(p);
  // nobody paid within a day: close it (a later successful lookup would still re-open it)
  if (lookup.status === "pending" && age > 24 * 3_600_000) {
    lookup = { ...lookup, status: "failed", failureReason: "Abandoned (no payment within 24 h)" };
  }
  return (await settle(p.id, lookup)).kind;
}

/** Maintenance (every 5 min): payments stuck at the gateway for > 15 minutes. */
export async function reconcileOpenPayments(batch = 100): Promise<number> {
  const open = await prisma.payment.findMany({
    where: {
      status: { in: ["initiated", "pending"] },
      initiatedAt: { lt: new Date(Date.now() - GATEWAY_GRACE_MS) },
    },
    select: { id: true },
    orderBy: { initiatedAt: "asc" },
    take: batch,
  });
  for (const { id } of open) {
    try {
      await reconcilePayment(id);
    } catch (err) {
      log.warn({ err, paymentId: id }, "reconcile failed; will retry next run");
    }
  }
  return open.length;
}

// ───────────── webhooks ─────────────

/** Store first (dedupe on the provider's event id), process in the worker, answer fast. */
export async function receiveStripeWebhook(rawBody: Buffer, signature: string | undefined) {
  if (!verifyStripeSignature(rawBody, signature)) {
    log.warn("stripe webhook with invalid signature");
    throw new AppError(401, "INVALID_SIGNATURE", "Webhook signature verification failed");
  }
  const event = JSON.parse(rawBody.toString("utf8")) as { id: string; type: string };
  await prisma.paymentWebhookEvent.createMany({
    data: [
      {
        provider: "stripe",
        eventKey: event.id,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  const row = await prisma.paymentWebhookEvent.findUniqueOrThrow({
    where: { provider_eventKey: { provider: "stripe", eventKey: event.id } },
  });
  if (!row.processedAt) {
    await getQueue("payments").add(
      "webhook",
      { kind: "webhook", id: row.id } satisfies PaymentJobData,
      {
        jobId: `webhook-${row.id}`,
        attempts: 10,
        backoff: { type: "exponential", delay: 30_000 },
      },
    );
  }
  return { received: true };
}

const STRIPE_SESSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

/** Worker: runs the same settle() as verify, after re-checking with the Stripe API. */
export async function processWebhookEvent(id: string): Promise<void> {
  const row = await prisma.paymentWebhookEvent.findUnique({ where: { id } });
  if (!row || row.processedAt) return;
  try {
    const event = row.payload as { type: string; data?: { object?: { id?: string } } };
    const sessionId = event.data?.object?.id;
    if (row.provider === "stripe" && STRIPE_SESSION_EVENTS.has(event.type) && sessionId) {
      const payment = await prisma.payment.findUnique({
        where: { provider_providerTxnId: { provider: "stripe", providerTxnId: sessionId } },
      });
      if (payment && payment.status !== "succeeded") {
        const lookup = await providerFor("stripe")!.lookup(payment); // don't trust the payload itself
        await settle(payment.id, lookup);
      }
    }
    await prisma.paymentWebhookEvent.update({
      where: { id },
      data: { processedAt: new Date(), error: null },
    });
  } catch (err) {
    await prisma.paymentWebhookEvent.update({
      where: { id },
      data: { error: err instanceof Error ? err.message.slice(0, 500) : "failed" },
    });
    throw err;
  }
}
