import { env } from "../../config/env.js";
import type { Refund } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError, Conflict, NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { refundsTotal } from "../../lib/metrics.js";
import { prisma } from "../../lib/prisma.js";
import { getQueue } from "../../lib/queue.js";
import type { AuthContext } from "../../middleware/auth.js";
import { cancelPendingBySystem } from "../bookings/bookings.service.js";
import { dispatch, queueEmail } from "../notifications/notifications.service.js";
import { providerFor } from "./providers/index.js";
import type { ProviderName } from "./providers/types.js";

const log = logger.child({ module: "refunds" });
const TX_OPTS = { maxWait: 2_000, timeout: 5_000 } as const;

/** Refunds the system starts on its own (event cancelled, paid after expiry). */
export const SYSTEM = { kind: "system" } as const;
export type RefundActor = typeof SYSTEM | { kind: "user"; auth: AuthContext };

export interface RefundJobData {
  refundId: string;
}

export const toRefundDto = (r: Refund) => ({
  id: r.id,
  bookingId: r.bookingId,
  amount: Number(r.amount),
  status: r.status,
  manual: r.manual,
  reason: r.reason,
  failureReason: r.failureReason,
  createdAt: r.createdAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
});

const enqueue = (refundId: string) =>
  getQueue("refunds")
    .add("refund", { refundId } satisfies RefundJobData, {
      jobId: `refund-${refundId}-${Date.now()}`,
      attempts: 8,
      backoff: { type: "exponential", delay: 60_000 },
    })
    .catch((err: unknown) => log.warn({ err, refundId }, "refund job not queued; use admin retry"));

/**
 * Full refund of a booking (backend.md policy, open question answered here):
 *  - buyer: until REFUND_CUTOFF_HOURS before the event starts, and only if no ticket was used
 *  - organizer of the event / admin: any time; organizers also need unused tickets
 *  - system: event cancelled, or paid after the booking expired and sold out
 * Tickets are voided and go back on sale immediately; the money moves in the `refunds` worker.
 * Free bookings are simply cancelled. Idempotent: a second request returns the same refund.
 */
export async function requestRefund(
  actor: RefundActor,
  bookingId: string,
  reason: string,
  ip: string | null,
): Promise<{ refund: ReturnType<typeof toRefundDto>; created: boolean }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    const b = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!b) throw NotFound("Booking");
    const event = await tx.event.findUniqueOrThrow({ where: { id: b.eventId } });

    let isPrivileged = actor.kind === "system";
    if (actor.kind === "user") {
      const { auth } = actor;
      const isBuyer = b.userId === auth.userId;
      const isOrganizer = event.organizerId === auth.userId;
      const isAdmin = auth.role === "admin";
      if (!isBuyer && !isOrganizer && !isAdmin) throw NotFound("Booking");
      isPrivileged = isAdmin;
      if (isBuyer && !isOrganizer && !isAdmin && event.status !== "cancelled") {
        const cutoff = event.startsAt.getTime() - env.REFUND_CUTOFF_HOURS * 3_600_000;
        if (Date.now() > cutoff) {
          throw Conflict(
            "REFUND_WINDOW_CLOSED",
            `Refunds close ${env.REFUND_CUTOFF_HOURS} hours before the event starts`,
          );
        }
      }
    }

    const existing = await tx.refund.findUnique({ where: { bookingId } });
    if (existing) return { refund: existing, created: false, notificationId: null };

    const payment = await tx.payment.findFirst({
      where: { bookingId, status: "succeeded" },
      orderBy: { completedAt: "desc" },
    });
    const refundable =
      b.status === "confirmed" ||
      (actor.kind === "system" &&
        (b.status === "expired" || b.status === "cancelled") &&
        !!payment);
    if (!refundable) {
      throw Conflict("BOOKING_NOT_REFUNDABLE", `A ${b.status} booking can't be refunded`);
    }

    const used = await tx.ticket.count({
      where: { bookingItem: { bookingId }, status: "checked_in" },
    });
    if (used > 0 && !isPrivileged) {
      throw Conflict("TICKETS_ALREADY_USED", `${used} ticket(s) of this booking were already used`);
    }

    const wasConfirmed = b.status === "confirmed";
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: payment ? "refunded" : "cancelled", cancelledAt: new Date() },
    });
    await tx.ticket.updateMany({
      where: { bookingItem: { bookingId }, status: { in: ["valid", "checked_in"] } },
      data: { status: payment ? "refunded" : "cancelled" },
    });
    if (wasConfirmed) {
      const items = await tx.bookingItem.findMany({
        where: { bookingId },
        orderBy: { ticketTypeId: "asc" },
      });
      for (const item of items) {
        await tx.$executeRaw`
          UPDATE ticket_types SET quantity_sold = quantity_sold - ${item.quantity}, updated_at = now()
          WHERE id = ${item.ticketTypeId}::uuid`;
      }
    }

    const refund = await tx.refund.create({
      data: {
        bookingId,
        paymentId: payment?.id ?? null,
        amount: payment?.amount ?? 0n,
        reason,
        // free bookings: nothing to send back
        status: payment ? "requested" : "succeeded",
        completedAt: payment ? null : new Date(),
        requestedBy: actor.kind === "user" ? actor.auth.userId : null,
      },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: b.userId } });
    const notificationId = await queueEmail(tx, {
      userId: b.userId,
      to: b.contactEmail,
      type: "booking.refunded",
      payload: {
        name: user.fullName,
        eventTitle: event.title,
        bookingCode: b.bookingCode,
        amount: Number(refund.amount),
        currency: b.currency,
        reason,
        free: !payment,
      },
    });
    await writeAudit(
      {
        actorId: actor.kind === "user" ? actor.auth.userId : null,
        action: "booking.refund_requested",
        entityType: "booking",
        entityId: bookingId,
        ip,
        diff: { refundId: refund.id, amount: Number(refund.amount), reason, by: actor.kind },
      },
      tx,
    );
    return { refund, created: true, notificationId };
  }, TX_OPTS);

  if (result.created) {
    refundsTotal.inc({ status: result.refund.status });
    if (result.refund.status === "requested") await enqueue(result.refund.id);
    if (result.notificationId) await dispatch([result.notificationId]);
    log.info({ bookingId, refundId: result.refund.id, by: actor.kind }, "refund.requested");
  }
  return { refund: toRefundDto(result.refund), created: result.created };
}

/** Worker: sends the money back through the gateway. Retried by BullMQ; failed after the last attempt. */
export async function processRefund(refundId: string, isLastAttempt: boolean): Promise<void> {
  const r = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!r || r.status === "succeeded" || (r.manual && r.status === "processing")) return;
  if (!r.payment) {
    await prisma.refund.update({
      where: { id: r.id },
      data: { status: "succeeded", completedAt: new Date() },
    });
    return;
  }
  const provider = providerFor(r.payment.provider as ProviderName);
  await prisma.refund.update({ where: { id: r.id }, data: { status: "processing" } });

  try {
    const result = provider
      ? await provider.refund(r.payment, r.amount, r.id)
      : ({ status: "manual" } as const);
    if (result.status === "manual") {
      await prisma.refund.update({
        where: { id: r.id },
        data: {
          manual: true,
          failureReason: `${r.payment.provider} has no refund API: refund it in the merchant portal, then mark it complete (POST /admin/refunds/${r.id}/complete)`,
        },
      });
      refundsTotal.inc({ status: "manual" });
      log.warn({ refundId, provider: r.payment.provider }, "refund needs manual action");
      return;
    }
    await prisma.$transaction([
      prisma.refund.update({
        where: { id: r.id },
        data: {
          status: "succeeded",
          completedAt: new Date(),
          providerRefundId: result.providerRefundId ?? null,
          failureReason: null,
        },
      }),
      prisma.payment.update({ where: { id: r.payment.id }, data: { status: "refunded" } }),
    ]);
    refundsTotal.inc({ status: "succeeded" });
    log.info({ refundId, provider: r.payment.provider }, "refund.succeeded");
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "refund failed";
    await prisma.refund.update({
      where: { id: r.id },
      data: { status: isLastAttempt ? "failed" : "processing", failureReason: message },
    });
    if (isLastAttempt) refundsTotal.inc({ status: "failed" });
    throw err;
  }
}

// ───────────── admin ─────────────

/** After settling a manual (eSewa) refund in the merchant portal, or fixing a failed one by hand. */
export async function completeManually(
  auth: AuthContext,
  refundId: string,
  providerRefundId: string | undefined,
  ip: string | null,
) {
  const r = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!r) throw NotFound("Refund");
  if (r.status === "succeeded") return toRefundDto(r);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.refund.update({
      where: { id: refundId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        providerRefundId: providerRefundId ?? r.providerRefundId,
        failureReason: null,
      },
    });
    if (r.paymentId)
      await tx.payment.update({ where: { id: r.paymentId }, data: { status: "refunded" } });
    await writeAudit(
      {
        actorId: auth.userId,
        action: "admin.refund_completed",
        entityType: "refund",
        entityId: refundId,
        ip,
        diff: { providerRefundId: providerRefundId ?? null },
      },
      tx,
    );
    return u;
  });
  refundsTotal.inc({ status: "succeeded" });
  return toRefundDto(updated);
}

export async function retry(auth: AuthContext, refundId: string, ip: string | null) {
  const r = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!r) throw NotFound("Refund");
  if (r.status !== "failed")
    throw new AppError(409, "REFUND_NOT_RETRYABLE", `This refund is ${r.status}`);
  const u = await prisma.refund.update({
    where: { id: refundId },
    data: { status: "requested", failureReason: null },
  });
  await writeAudit({
    actorId: auth.userId,
    action: "admin.refund_retried",
    entityType: "refund",
    entityId: refundId,
    ip,
  });
  await enqueue(refundId);
  return toRefundDto(u);
}

// ───────────── event cancelled → fan-out ─────────────

export interface FanoutJobData {
  eventId: string;
}

/**
 * Worker: pages through the event's open bookings (100 at a time). Unpaid holds are released,
 * confirmed bookings are refunded (or cancelled if free) and the buyers are emailed.
 * Safe to re-run: every step is idempotent.
 */
export async function fanoutEventCancellation(eventId: string): Promise<number> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "cancelled") return 0;
  let after: string | undefined;
  let handled = 0;
  for (;;) {
    const batch = await prisma.booking.findMany({
      where: {
        eventId,
        status: { in: ["pending", "confirmed"] },
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true, status: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (batch.length === 0) break;
    for (const b of batch) {
      if (b.status === "pending") await cancelPendingBySystem(b.id);
      else
        await requestRefund(
          SYSTEM,
          b.id,
          `Event cancelled: ${event.cancellationReason ?? "by the organizer"}`,
          null,
        );
      handled++;
    }
    after = batch.at(-1)!.id;
  }
  log.info({ eventId, handled }, "event.cancellation_fanout_done");
  return handled;
}

export const enqueueFanout = (eventId: string) =>
  getQueue("fanout").add("event-cancelled", { eventId } satisfies FanoutJobData, {
    jobId: `cancel-${eventId}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
  });
