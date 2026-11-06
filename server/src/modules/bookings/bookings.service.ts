import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { newBookingCode } from "../../lib/codes.js";
import {
  AppError,
  Conflict,
  isUniqueViolation,
  NotFound,
  Unprocessable,
} from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import {
  bookingsConfirmed,
  bookingsCreated,
  bookingsExpired,
  ticketsSoldOut,
} from "../../lib/metrics.js";
import { decodeCursor, toPage } from "../../lib/pagination.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import { getQueue } from "../../lib/queue.js";
import type { AuthContext } from "../../middleware/auth.js";
import { dispatch, queueEmail } from "../notifications/notifications.service.js";
import { discountFor, findUsable, redeemInTx } from "../promo-codes/promo-codes.service.js";
import { enqueueTicketPdfs, issueTickets } from "../tickets/tickets.service.js";
import {
  fullBookingInclude,
  toBookingDto,
  type BookingDto,
  type FullBooking,
} from "./bookings.dto.js";
import type { CreateBookingBody, MyBookingsQuery } from "./bookings.schemas.js";

const log = logger.child({ module: "bookings" });
const TX_OPTS = { maxWait: 2_000, timeout: 5_000 } as const;
const HOLD_MS = env.BOOKING_HOLD_MINUTES * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BookingExpiryJobData {
  bookingId: string;
}

const loadFull = async (id: string, db: DbOrTx = prisma) =>
  (await db.booking.findUnique({
    where: { id },
    include: fullBookingInclude,
  })) as FullBooking | null;

// ───────────── create ─────────────

/** Checks that give the buyer a precise reason, before the atomic stock update. */
async function validateRequest(input: CreateBookingBody) {
  const event = await prisma.event.findFirst({ where: { id: input.eventId, deletedAt: null } });
  if (!event || event.status === "draft" || event.visibility === "private") {
    throw NotFound("Event");
  }
  if (event.status !== "published") {
    throw Conflict("EVENT_NOT_ON_SALE", `This event is ${event.status}`);
  }
  if (event.endsAt <= new Date()) throw Conflict("EVENT_NOT_ON_SALE", "This event has ended");

  const types = await prisma.ticketType.findMany({
    where: { id: { in: input.items.map((i) => i.ticketTypeId) }, eventId: event.id },
  });
  const now = new Date();
  for (const item of input.items) {
    const t = types.find((x) => x.id === item.ticketTypeId);
    if (!t || !t.isActive) {
      throw Unprocessable("INVALID_TICKET_TYPE", "Ticket type not found for this event", {
        ticketTypeId: item.ticketTypeId,
      });
    }
    if (t.salesStartAt && t.salesStartAt > now) {
      throw Conflict(
        "SALES_NOT_STARTED",
        `Sales for '${t.name}' start at ${t.salesStartAt.toISOString()}`,
        {
          ticketTypeId: t.id,
        },
      );
    }
    if (t.salesEndAt && t.salesEndAt <= now) {
      throw Conflict("SALES_ENDED", `Sales for '${t.name}' have ended`, { ticketTypeId: t.id });
    }
    if (item.quantity < t.minPerOrder || item.quantity > t.maxPerOrder) {
      throw Unprocessable(
        "INVALID_QUANTITY",
        `'${t.name}': order between ${t.minPerOrder} and ${t.maxPerOrder} tickets`,
        { ticketTypeId: t.id, min: t.minPerOrder, max: t.maxPerOrder },
      );
    }
  }
  return event;
}

/**
 * Hot path (backend.md §6.1). Stock is reserved with one conditional UPDATE per ticket type,
 * in id order (no deadlocks). If any doesn't fit, the whole transaction rolls back → 409.
 * Free bookings (total 0) are confirmed and ticketed in the same transaction.
 */
export async function create(
  auth: AuthContext,
  input: CreateBookingBody,
  idempotencyKey: string,
): Promise<{ booking: BookingDto; created: boolean }> {
  const event = await validateRequest(input);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
  const items = [...input.items].sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
  // explains a bad code before any stock is touched; the redemption itself is claimed in the tx
  const promo = input.promoCode ? await findUsable(event.id, input.promoCode) : null;

  let result: { bookingId: string; confirmed: Confirmation | null } | undefined;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const priced: {
          ticketTypeId: string;
          quantity: number;
          unitPrice: bigint;
          currency: string;
        }[] = [];
        for (const item of items) {
          const rows = await tx.$queryRaw<{ price: bigint; currency: string }[]>`
            UPDATE ticket_types
            SET quantity_reserved = quantity_reserved + ${item.quantity}, updated_at = now()
            WHERE id = ${item.ticketTypeId}::uuid
              AND event_id = ${event.id}::uuid
              AND is_active
              AND now() >= coalesce(sales_start_at, '-infinity')
              AND now() < coalesce(sales_end_at, 'infinity')
              AND quantity_reserved + quantity_sold + ${item.quantity} <= quantity_total
            RETURNING price, currency`;
          if (rows.length === 0) {
            const t = await tx.ticketType.findUnique({ where: { id: item.ticketTypeId } });
            const available = t
              ? Math.max(0, t.quantityTotal - t.quantityReserved - t.quantitySold)
              : 0;
            ticketsSoldOut.inc();
            throw Conflict(
              "TICKET_SOLD_OUT",
              available === 0
                ? `'${t?.name ?? "This ticket"}' is sold out`
                : `Only ${available} '${t?.name}' tickets left; ${item.quantity} requested`,
              { ticketTypeId: item.ticketTypeId, available },
            );
          }
          priced.push({ ...item, unitPrice: rows[0]!.price, currency: rows[0]!.currency });
        }

        const currency = priced[0]!.currency;
        if (priced.some((p) => p.currency !== currency)) {
          throw Unprocessable("MIXED_CURRENCY", "All tickets in one booking must share a currency");
        }
        const subtotal = priced.reduce((sum, p) => sum + p.unitPrice * BigInt(p.quantity), 0n);
        let discount = 0n;
        if (promo) {
          if (!(await redeemInTx(tx, promo.id))) {
            throw Conflict("PROMO_CODE_EXHAUSTED", "This code has just been used up");
          }
          discount = discountFor(promo, subtotal);
        }
        const total = subtotal - discount;

        const booking = await tx.booking.create({
          data: {
            bookingCode: newBookingCode(),
            userId: auth.userId,
            eventId: event.id,
            subtotal,
            discountAmount: discount,
            totalAmount: total, // platform fees: none yet
            promoCodeId: promo?.id ?? null,
            currency,
            expiresAt: new Date(Date.now() + HOLD_MS),
            idempotencyKey,
            contactEmail: user.email,
            contactPhone: input.contactPhone ?? user.phone,
            items: {
              create: priced.map((p) => ({
                ticketTypeId: p.ticketTypeId,
                quantity: p.quantity,
                unitPrice: p.unitPrice,
                lineTotal: p.unitPrice * BigInt(p.quantity),
              })),
            },
          },
        });

        // nothing to pay (free tickets or a 100% code): confirm right away
        const confirmed = total === 0n ? await confirmInTx(tx, booking.id) : null;
        return { bookingId: booking.id, confirmed };
      }, TX_OPTS);
    } catch (err) {
      // retry once on the (astronomically unlikely) booking code collision
      if (isUniqueViolation(err, "booking_code") && attempt === 0) continue;
      // same Idempotency-Key reached the DB twice (e.g. Redis was flushed): return the original
      if (isUniqueViolation(err, "idempotency_key")) {
        const existing = await prisma.booking.findFirst({
          where: { userId: auth.userId, idempotencyKey },
        });
        if (existing)
          return { booking: toBookingDto((await loadFull(existing.id))!), created: false };
      }
      throw err;
    }
  }

  const { bookingId, confirmed } = result!;
  if (confirmed) {
    await afterConfirm(confirmed);
  } else {
    // precise expiry; the every-minute sweep is the safety net if this job is lost
    await getQueue("booking-expiry")
      .add("expire", { bookingId } satisfies BookingExpiryJobData, {
        jobId: bookingId,
        delay: HOLD_MS + 1_000,
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
      })
      .catch((err: unknown) =>
        log.warn({ err, bookingId }, "expiry job not queued; sweep will expire it"),
      );
  }
  bookingsCreated.inc({ free: String(!!confirmed) });
  log.info({ bookingId, eventId: event.id, free: !!confirmed }, "booking.created");
  return { booking: toBookingDto((await loadFull(bookingId))!), created: true };
}

// ───────────── confirm (free now; payments module later) ─────────────

export interface Confirmation {
  bookingId: string;
  tickets: { id: string; updatedAt: Date }[];
  notificationId: string;
}

/**
 * pending → confirmed inside the caller's transaction: reserved → sold, tickets issued,
 * confirmation email queued (outbox). Returns null if the booking was no longer pending
 * (already confirmed, expired or cancelled), which makes it safe to call twice.
 */
export async function confirmInTx(tx: DbOrTx, bookingId: string): Promise<Confirmation | null> {
  const { count } = await tx.booking.updateMany({
    where: { id: bookingId, status: "pending" },
    data: { status: "confirmed", confirmedAt: new Date() },
  });
  if (count === 0) return null;

  // sequential reads: queries on one transaction connection must not run in parallel
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const event = await tx.event.findUniqueOrThrow({ where: { id: booking.eventId } });
  const user = await tx.user.findUniqueOrThrow({ where: { id: booking.userId } });
  const items = await tx.bookingItem.findMany({
    where: { bookingId },
    orderBy: { ticketTypeId: "asc" },
  });
  for (const item of items) {
    await tx.$executeRaw`
      UPDATE ticket_types
      SET quantity_reserved = quantity_reserved - ${item.quantity},
          quantity_sold = quantity_sold + ${item.quantity},
          updated_at = now()
      WHERE id = ${item.ticketTypeId}::uuid`;
  }
  const tickets = await issueTickets(tx, booking.eventId, items);
  const notificationId = await queueEmail(tx, {
    userId: booking.userId,
    to: booking.contactEmail,
    type: "booking.confirmed",
    payload: {
      name: user.fullName,
      eventTitle: event.title,
      startsAt: event.startsAt.toISOString(),
      timezone: event.timezone,
      bookingCode: booking.bookingCode,
      ticketCount: tickets.length,
      totalAmount: Number(booking.totalAmount),
      currency: booking.currency,
    },
  });
  return { bookingId, tickets, notificationId };
}

/** Side effects after commit: email + ticket PDFs (both have safety-net sweeps). */
export async function afterConfirm(c: Confirmation): Promise<void> {
  bookingsConfirmed.inc();
  await dispatch([c.notificationId]);
  await enqueueTicketPdfs(c.tickets);
  log.info({ bookingId: c.bookingId, tickets: c.tickets.length }, "booking.confirmed");
}

// ───────────── read ─────────────

/** The buyer, the event's organizer, or an admin. Others get 404. */
export async function get(auth: AuthContext, id: string): Promise<BookingDto> {
  const b = await loadFull(id);
  if (!b) throw NotFound("Booking");
  const isOwner = b.userId === auth.userId;
  const isOrganizer = b.event.organizerId === auth.userId;
  if (!isOwner && !isOrganizer && auth.role !== "admin") throw NotFound("Booking");
  return toBookingDto(b, { includeContact: true });
}

const isIdCursor = (v: unknown): v is { id: string } =>
  typeof (v as { id?: unknown } | null)?.id === "string" && UUID.test((v as { id: string }).id);

export async function listMine(auth: AuthContext, query: MyBookingsQuery) {
  const afterId = query.cursor ? decodeCursor(query.cursor, isIdCursor).id : undefined;
  const rows = (await prisma.booking.findMany({
    where: {
      userId: auth.userId,
      ...(query.status ? { status: query.status } : {}),
      ...(afterId ? { id: { lt: afterId } } : {}),
    },
    include: fullBookingInclude,
    orderBy: { id: "desc" },
    take: query.limit + 1,
  })) as FullBooking[];
  return toPage(
    rows,
    query.limit,
    (b) => toBookingDto(b),
    (b) => ({ id: b.id }),
  );
}

// ───────────── release holds ─────────────

/** pending → cancelled|expired and give the held stock back. Returns false if not pending. */
async function release(
  bookingId: string,
  to: "cancelled" | "expired",
  where: Prisma.BookingWhereInput = {},
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: "pending", ...where },
      data: { status: to, ...(to === "cancelled" ? { cancelledAt: new Date() } : {}) },
    });
    if (count === 0) return false;
    const items = await tx.bookingItem.findMany({
      where: { bookingId },
      orderBy: { ticketTypeId: "asc" },
    });
    for (const item of items) {
      await tx.$executeRaw`
        UPDATE ticket_types
        SET quantity_reserved = quantity_reserved - ${item.quantity}, updated_at = now()
        WHERE id = ${item.ticketTypeId}::uuid`;
    }
    // give the promo code redemption back too
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.promoCodeId) {
      await tx.$executeRaw`
        UPDATE promo_codes SET times_redeemed = times_redeemed - 1, updated_at = now()
        WHERE id = ${b.promoCodeId}::uuid AND times_redeemed > 0`;
    }
    return true;
  }, TX_OPTS);
}

/** System cancel of an unpaid booking (event cancelled). Returns false if it wasn't pending. */
export const cancelPendingBySystem = (bookingId: string) => release(bookingId, "cancelled");

/**
 * A payment succeeded after its booking had expired or been cancelled. Try to hold the same
 * tickets again (in id order, all-or-nothing). Returns true if the booking is pending again,
 * ready for confirmInTx; false if the stock is gone (→ the caller refunds).
 */
export async function reholdInTx(tx: DbOrTx, bookingId: string): Promise<boolean> {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  if (b.status !== "expired" && b.status !== "cancelled") return false;
  const event = await tx.event.findUniqueOrThrow({ where: { id: b.eventId } });
  if (event.status !== "published" || event.endsAt <= new Date()) return false;

  const items = await tx.bookingItem.findMany({
    where: { bookingId },
    orderBy: { ticketTypeId: "asc" },
  });
  const held: typeof items = [];
  for (const item of items) {
    const n = await tx.$executeRaw`
      UPDATE ticket_types
      SET quantity_reserved = quantity_reserved + ${item.quantity}, updated_at = now()
      WHERE id = ${item.ticketTypeId}::uuid
        AND quantity_reserved + quantity_sold + ${item.quantity} <= quantity_total`;
    if (n === 0) {
      for (const h of held) {
        await tx.$executeRaw`
          UPDATE ticket_types SET quantity_reserved = quantity_reserved - ${h.quantity}
          WHERE id = ${h.ticketTypeId}::uuid`;
      }
      return false;
    }
    held.push(item);
  }
  if (b.promoCodeId) {
    // they paid the discounted price: honour it even if the code ran out meanwhile
    await tx.$executeRaw`UPDATE promo_codes SET times_redeemed = times_redeemed + 1 WHERE id = ${b.promoCodeId}::uuid
      AND (max_redemptions IS NULL OR times_redeemed < max_redemptions)`;
  }
  await tx.booking.update({
    where: { id: bookingId },
    data: { status: "pending", cancelledAt: null, expiresAt: new Date(Date.now() + 5 * 60_000) },
  });
  log.warn({ bookingId }, "booking.reheld_after_late_payment");
  return true;
}

/** The buyer cancels an unpaid booking. Confirmed bookings need a refund (payments module). */
export async function cancel(auth: AuthContext, id: string): Promise<BookingDto> {
  const b = await prisma.booking.findUnique({ where: { id } });
  if (!b || b.userId !== auth.userId) throw NotFound("Booking");
  if (!(await release(id, "cancelled"))) {
    throw new AppError(
      409,
      "BOOKING_NOT_CANCELLABLE",
      b.status === "confirmed"
        ? "Confirmed bookings can't be cancelled here; request a refund instead"
        : `This booking is already ${b.status}`,
    );
  }
  log.info({ bookingId: id }, "booking.cancelled");
  return toBookingDto((await loadFull(id))!);
}

/** Delayed job + sweep: only expires bookings whose deadline has passed. */
export async function expire(bookingId: string): Promise<boolean> {
  const done = await release(bookingId, "expired", { expiresAt: { lte: new Date() } });
  if (done) {
    bookingsExpired.inc();
    log.info({ bookingId }, "booking.expired");
  }
  return done;
}

/** Maintenance (every minute): expire anything the delayed jobs missed. */
export async function sweepExpired(batch = 200): Promise<number> {
  const due = await prisma.booking.findMany({
    where: { status: "pending", expiresAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: batch,
  });
  let n = 0;
  for (const { id } of due) if (await expire(id)) n++;
  return n;
}
