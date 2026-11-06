import type { Event } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError, Conflict, NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthContext } from "../../middleware/auth.js";
import type { AddStaffBody } from "./tickets.schemas.js";

const log = logger.child({ module: "checkins" });

// ───────────── access ─────────────

async function loadEvent(id: string) {
  const event = await prisma.event.findFirst({ where: { id, deletedAt: null } });
  if (!event) throw NotFound("Event");
  return event;
}

/** Organizer, admin, or anyone on the event's staff list. Others get 404 (no existence leak). */
async function requireScanner(auth: AuthContext, eventId: string): Promise<Event> {
  const event = await loadEvent(eventId);
  if (event.organizerId === auth.userId || auth.role === "admin") return event;
  const staff = await prisma.eventStaff.findUnique({
    where: { eventId_userId: { eventId, userId: auth.userId } },
  });
  if (!staff) throw NotFound("Event");
  return event;
}

/** Only the organizer (and admins) manage the staff list. */
async function requireOrganizer(auth: AuthContext, eventId: string): Promise<Event> {
  const event = await loadEvent(eventId);
  if (event.organizerId !== auth.userId && auth.role !== "admin") throw NotFound("Event");
  return event;
}

// ───────────── check-in ─────────────

/**
 * One atomic UPDATE … WHERE status = 'valid' (database.md §4.3): two gates scanning the same
 * QR at the same moment → exactly one "admitted". On 0 rows a follow-up read tells the scanner why.
 */
export async function checkIn(auth: AuthContext, eventId: string, ticketCode: string) {
  const event = await requireScanner(auth, eventId);
  if (event.status !== "published") {
    throw Conflict("EVENT_NOT_ACTIVE", `Check-in is closed: the event is ${event.status}`);
  }

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE tickets
    SET status = 'checked_in', checked_in_at = now(), checked_in_by = ${auth.userId}::uuid, updated_at = now()
    WHERE ticket_code = ${ticketCode} AND event_id = ${eventId}::uuid AND status = 'valid'
    RETURNING id`;

  const t = await prisma.ticket.findUnique({
    where: { ticketCode },
    include: {
      ticketType: true,
      scanner: { select: { fullName: true } },
      bookingItem: { include: { booking: { include: { user: { select: { fullName: true } } } } } },
    },
  });

  if (rows.length === 1 && t) {
    log.info({ eventId, ticketId: t.id, scannerId: auth.userId }, "checkin.admitted");
    return {
      result: "admitted" as const,
      ticket: {
        id: t.id,
        ticketCode: t.ticketCode,
        ticketType: t.ticketType.name,
        holderName: t.holderName ?? t.bookingItem.booking.user.fullName,
        bookingCode: t.bookingItem.booking.bookingCode,
        checkedInAt: t.checkedInAt!.toISOString(),
      },
    };
  }

  // why not? (the scanner app shows a different screen for each)
  log.info({ eventId, scannerId: auth.userId, found: !!t, status: t?.status }, "checkin.rejected");
  if (!t) throw new AppError(404, "TICKET_NOT_FOUND", "No ticket with this code");
  if (t.eventId !== eventId) throw Conflict("WRONG_EVENT", "This ticket is for a different event");
  if (t.status === "checked_in") {
    throw Conflict("ALREADY_CHECKED_IN", "This ticket was already used", {
      checkedInAt: t.checkedInAt?.toISOString(),
      checkedInBy: t.scanner?.fullName ?? null,
      holderName: t.holderName ?? t.bookingItem.booking.user.fullName,
    });
  }
  throw Conflict("TICKET_NOT_VALID", `This ticket is ${t.status}`, { status: t.status });
}

/** Door dashboard: issued vs checked in, overall and per ticket type. */
export async function stats(auth: AuthContext, eventId: string) {
  await requireScanner(auth, eventId);
  const grouped = await prisma.ticket.groupBy({
    by: ["ticketTypeId", "status"],
    where: { eventId },
    _count: { _all: true },
  });
  const types = await prisma.ticketType.findMany({
    where: { eventId },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  const count = (typeId: string | null, status: string) =>
    grouped
      .filter((g) => (typeId === null || g.ticketTypeId === typeId) && g.status === status)
      .reduce((n, g) => n + g._count._all, 0);
  const summary = (typeId: string | null) => {
    const checkedIn = count(typeId, "checked_in");
    const issued = checkedIn + count(typeId, "valid");
    return { issued, checkedIn, remaining: issued - checkedIn };
  };
  return {
    eventId,
    ...summary(null),
    byTicketType: types.map((t) => ({ ticketTypeId: t.id, name: t.name, ...summary(t.id) })),
  };
}

// ───────────── staff ─────────────

const toStaffDto = (s: {
  userId: string;
  role: string;
  createdAt: Date;
  user: { fullName: string; email: string };
}) => ({
  userId: s.userId,
  fullName: s.user.fullName,
  email: s.user.email,
  role: s.role,
  addedAt: s.createdAt.toISOString(),
});

export async function listStaff(auth: AuthContext, eventId: string) {
  await requireOrganizer(auth, eventId);
  const rows = await prisma.eventStaff.findMany({
    where: { eventId },
    include: { user: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toStaffDto);
}

/** Adds (or changes the role of) a staff member by email. They must have an account. */
export async function addStaff(
  auth: AuthContext,
  eventId: string,
  input: AddStaffBody,
  ip: string | null,
) {
  const event = await requireOrganizer(auth, eventId);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || user.status !== "active") {
    throw new AppError(
      404,
      "USER_NOT_FOUND",
      "No active account with this email; ask them to sign up first",
    );
  }
  if (user.id === event.organizerId) {
    throw Conflict("ALREADY_ORGANIZER", "The organizer can already scan tickets");
  }
  const row = await prisma.$transaction(async (tx) => {
    const s = await tx.eventStaff.upsert({
      where: { eventId_userId: { eventId, userId: user.id } },
      create: { eventId, userId: user.id, role: input.role, addedBy: auth.userId },
      update: { role: input.role },
      include: { user: { select: { fullName: true, email: true } } },
    });
    await writeAudit(
      {
        actorId: auth.userId,
        action: "event.staff_added",
        entityType: "event",
        entityId: eventId,
        ip,
        diff: { userId: user.id, role: input.role },
      },
      tx,
    );
    return s;
  });
  return toStaffDto(row);
}

export async function removeStaff(
  auth: AuthContext,
  eventId: string,
  userId: string,
  ip: string | null,
) {
  await requireOrganizer(auth, eventId);
  const { count } = await prisma.eventStaff.deleteMany({ where: { eventId, userId } });
  if (count === 0) throw NotFound("Staff member");
  await writeAudit({
    actorId: auth.userId,
    action: "event.staff_removed",
    entityType: "event",
    entityId: eventId,
    ip,
    diff: { userId },
  });
}

/** For the scanner app: events I can scan for (as staff), soonest first. */
export async function myStaffEvents(auth: AuthContext) {
  const rows = await prisma.eventStaff.findMany({
    where: {
      userId: auth.userId,
      event: { deletedAt: null, status: { in: ["published", "completed"] } },
    },
    include: { event: true },
  });
  return rows
    .map((s) => ({
      eventId: s.eventId,
      title: s.event.title,
      slug: s.event.slug,
      status: s.event.status,
      startsAt: s.event.startsAt.toISOString(),
      endsAt: s.event.endsAt.toISOString(),
      role: s.role,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
