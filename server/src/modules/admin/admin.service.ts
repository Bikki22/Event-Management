import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { decodeCursor, toPage } from "../../lib/pagination.js";
import { prisma } from "../../lib/prisma.js";
import { toPaymentDto } from "../payments/payments.service.js";
import { toRefundDto } from "../payments/refunds.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateOrDateTime = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((s) => new Date(s));
const limit = z.coerce.number().int().min(1).max(200).default(50);

// ───────────── audit logs ─────────────

export const auditQuery = z
  .object({
    actorId: z.uuid().optional(),
    action: z.string().trim().min(1).max(100).optional(), // prefix, e.g. "admin." or "event.published"
    entityType: z.string().trim().min(1).max(50).optional(),
    entityId: z.string().trim().min(1).max(100).optional(),
    from: dateOrDateTime.optional(),
    to: dateOrDateTime.optional(),
    limit,
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuery>;

const isBigIdCursor = (v: unknown): v is { id: string } =>
  typeof (v as { id?: unknown } | null)?.id === "string" &&
  /^\d{1,19}$/.test((v as { id: string }).id);

/** Newest first; append-only table keyed by a bigserial id. */
export async function auditLogs(q: AuditQuery) {
  const before = q.cursor ? BigInt(decodeCursor(q.cursor, isBigIdCursor).id) : undefined;
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
        : {}),
      ...(before !== undefined ? { id: { lt: before } } : {}),
    },
    include: { actor: { select: { fullName: true, email: true } } },
    orderBy: { id: "desc" },
    take: q.limit + 1,
  });
  return toPage(
    rows,
    q.limit,
    (r) => ({
      id: r.id.toString(),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor: r.actorId
        ? { id: r.actorId, name: r.actor?.fullName ?? null, email: r.actor?.email ?? null }
        : null,
      diff: r.diff,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }),
    (r) => ({ id: r.id.toString() }),
  );
}

// ───────────── payments / refunds ─────────────

const isUuidCursor = (v: unknown): v is { id: string } =>
  typeof (v as { id?: unknown } | null)?.id === "string" && UUID.test((v as { id: string }).id);

export const paymentsQuery = z
  .object({
    status: z
      .enum(["initiated", "pending", "succeeded", "failed", "cancelled", "refunded"])
      .optional(),
    provider: z.enum(["esewa", "khalti", "stripe", "free", "mock"]).optional(),
    bookingId: z.uuid().optional(),
    limit,
    cursor: z.string().max(200).optional(),
  })
  .strict();

export async function payments(q: z.infer<typeof paymentsQuery>) {
  const before = q.cursor ? decodeCursor(q.cursor, isUuidCursor).id : undefined;
  const rows = await prisma.payment.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.provider ? { provider: q.provider } : {}),
      ...(q.bookingId ? { bookingId: q.bookingId } : {}),
      ...(before ? { id: { lt: before } } : {}),
    },
    orderBy: { id: "desc" },
    take: q.limit + 1,
  });
  return toPage(
    rows,
    q.limit,
    (p) => ({ ...toPaymentDto(p), providerTxnId: p.providerTxnId, providerRef: p.providerRef }),
    (p) => ({ id: p.id }),
  );
}

export const refundsQuery = z
  .object({
    status: z.enum(["requested", "processing", "succeeded", "failed"]).optional(),
    manual: z.stringbool().optional(),
    limit,
    cursor: z.string().max(200).optional(),
  })
  .strict();

export async function refunds(q: z.infer<typeof refundsQuery>) {
  const before = q.cursor ? decodeCursor(q.cursor, isUuidCursor).id : undefined;
  const rows = await prisma.refund.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.manual !== undefined ? { manual: q.manual } : {}),
      ...(before ? { id: { lt: before } } : {}),
    },
    include: {
      payment: { select: { provider: true } },
      booking: { select: { bookingCode: true, currency: true } },
    },
    orderBy: { id: "desc" },
    take: q.limit + 1,
  });
  return toPage(
    rows,
    q.limit,
    (r) => ({
      ...toRefundDto(r),
      provider: r.payment?.provider ?? null,
      bookingCode: r.booking.bookingCode,
      currency: r.booking.currency,
    }),
    (r) => ({ id: r.id }),
  );
}

// ───────────── dashboard ─────────────

/** Platform overview. Revenue = confirmed booking totals (refunded bookings are excluded). */
export async function stats() {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const count = (where: Prisma.BookingWhereInput) => prisma.booking.count({ where });
  const [
    users,
    newUsers,
    organizersPending,
    eventsLive,
    bookingsConfirmed,
    bookingsToday,
    revenue,
    refundsOpen,
    refundsManual,
    paymentsFailed24h,
  ] = await Promise.all([
    prisma.user.count({ where: { status: { not: "deleted" } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.organizerProfile.count({ where: { verificationStatus: "pending" } }),
    prisma.event.count({
      where: { status: "published", deletedAt: null, endsAt: { gt: new Date() } },
    }),
    count({ status: "confirmed" }),
    count({ status: "confirmed", confirmedAt: { gte: dayAgo } }),
    prisma.booking.groupBy({
      by: ["currency"],
      where: { status: "confirmed" },
      _sum: { totalAmount: true },
    }),
    prisma.refund.count({ where: { status: { in: ["requested", "processing", "failed"] } } }),
    prisma.refund.count({ where: { manual: true, status: "processing" } }),
    prisma.payment.count({ where: { status: "failed", initiatedAt: { gte: dayAgo } } }),
  ]);
  return {
    users: { total: users, newLast7Days: newUsers },
    organizers: { pendingVerification: organizersPending },
    events: { live: eventsLive },
    bookings: { confirmed: bookingsConfirmed, confirmedLast24h: bookingsToday },
    revenue: revenue.map((r) => ({
      currency: r.currency,
      amount: Number(r._sum.totalAmount ?? 0n),
    })),
    refunds: { open: refundsOpen, awaitingManualAction: refundsManual },
    payments: { failedLast24h: paymentsFailed24h },
  };
}
