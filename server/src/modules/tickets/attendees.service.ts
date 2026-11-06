import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError, NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { decodeCursor, toPage } from "../../lib/pagination.js";
import { prisma } from "../../lib/prisma.js";
import { getQueue } from "../../lib/queue.js";
import { putObject, signedDownloadUrl } from "../../lib/storage.js";
import type { AuthContext } from "../../middleware/auth.js";
import { dispatch, queueEmail } from "../notifications/notifications.service.js";

const log = logger.child({ module: "attendees" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const attendeesQuery = z
  .object({
    status: z.enum(["valid", "checked_in", "cancelled", "refunded"]).optional(),
    q: z.string().trim().min(1).max(100).optional(), // name, email, ticket or booking code
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(300).optional(),
  })
  .strict();
export type AttendeesQuery = z.infer<typeof attendeesQuery>;

export interface ExportJobData {
  exportId: string;
}

/** Organizer, admins and event managers (scanners don't see personal data lists). */
async function requireAttendeeAccess(auth: AuthContext, eventId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) throw NotFound("Event");
  if (event.organizerId === auth.userId || auth.role === "admin") return event;
  const staff = await prisma.eventStaff.findUnique({
    where: { eventId_userId: { eventId, userId: auth.userId } },
  });
  if (staff?.role !== "manager") throw NotFound("Event");
  return event;
}

const attendeeInclude = {
  ticketType: { select: { name: true } },
  bookingItem: {
    select: {
      unitPrice: true,
      booking: {
        select: {
          bookingCode: true,
          currency: true,
          contactEmail: true,
          contactPhone: true,
          user: { select: { fullName: true } },
        },
      },
    },
  },
} as const;
type AttendeeRow = Prisma.TicketGetPayload<{ include: typeof attendeeInclude }>;

const toAttendee = (t: AttendeeRow) => {
  const b = t.bookingItem.booking;
  return {
    ticketId: t.id,
    ticketCode: t.ticketCode,
    ticketType: t.ticketType.name,
    status: t.status,
    name: t.holderName ?? b.user.fullName,
    email: t.holderEmail ?? b.contactEmail,
    buyer: { name: b.user.fullName, email: b.contactEmail, phone: b.contactPhone },
    bookingCode: b.bookingCode,
    price: Number(t.bookingItem.unitPrice),
    currency: b.currency,
    checkedInAt: t.checkedInAt?.toISOString() ?? null,
    issuedAt: t.createdAt.toISOString(),
  };
};

function where(
  eventId: string,
  q: Omit<AttendeesQuery, "limit" | "cursor">,
): Prisma.TicketWhereInput {
  return {
    eventId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.q
      ? {
          OR: [
            { holderName: { contains: q.q, mode: "insensitive" } },
            { holderEmail: { contains: q.q, mode: "insensitive" } },
            { ticketCode: { equals: q.q.toUpperCase() } },
            { bookingItem: { booking: { bookingCode: { equals: q.q.toUpperCase() } } } },
            { bookingItem: { booking: { contactEmail: { contains: q.q, mode: "insensitive" } } } },
            {
              bookingItem: {
                booking: { user: { fullName: { contains: q.q, mode: "insensitive" } } },
              },
            },
          ],
        }
      : {}),
  };
}

const isIdCursor = (v: unknown): v is { id: string } =>
  typeof (v as { id?: unknown } | null)?.id === "string" && UUID.test((v as { id: string }).id);

export async function list(auth: AuthContext, eventId: string, query: AttendeesQuery) {
  await requireAttendeeAccess(auth, eventId);
  const { limit, cursor, ...filter } = query;
  const afterId = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
  const rows = await prisma.ticket.findMany({
    where: { ...where(eventId, filter), ...(afterId ? { id: { gt: afterId } } : {}) },
    include: attendeeInclude,
    orderBy: { id: "asc" },
    take: limit + 1,
  });
  return toPage(rows, limit, toAttendee, (t) => ({ id: t.id }));
}

// ───────────── CSV export ─────────────

export async function requestExport(auth: AuthContext, eventId: string, ip: string | null) {
  await requireAttendeeAccess(auth, eventId);
  const running = await prisma.export.count({
    where: { eventId, requestedBy: auth.userId, status: { in: ["queued", "processing"] } },
  });
  if (running > 0)
    throw new AppError(409, "EXPORT_IN_PROGRESS", "An export for this event is already running");
  const exp = await prisma.export.create({ data: { eventId, requestedBy: auth.userId } });
  await writeAudit({
    actorId: auth.userId,
    action: "event.attendees_exported",
    entityType: "event",
    entityId: eventId,
    ip,
    diff: { exportId: exp.id },
  });
  await getQueue("exports").add("attendees-csv", { exportId: exp.id } satisfies ExportJobData, {
    jobId: exp.id,
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
  });
  return { id: exp.id, status: exp.status, createdAt: exp.createdAt.toISOString() };
}

/** Requester (or admin) only. A ready export comes with a 10-minute signed download link. */
export async function getExport(auth: AuthContext, id: string) {
  const exp = await prisma.export
    .findUnique({ where: { id }, include: { event: true } })
    .catch(() => null);
  if (!exp || (exp.requestedBy !== auth.userId && auth.role !== "admin")) throw NotFound("Export");
  return {
    id: exp.id,
    eventId: exp.eventId,
    status: exp.status,
    rowCount: exp.rowCount,
    error: exp.error,
    createdAt: exp.createdAt.toISOString(),
    completedAt: exp.completedAt?.toISOString() ?? null,
    downloadUrl:
      exp.status === "ready" && exp.objectKey
        ? await signedDownloadUrl(exp.objectKey, {
            expiresInSeconds: 600,
            filename: `${exp.event.slug}-attendees.csv`,
          })
        : null,
  };
}

/** Quotes every field; neutralises spreadsheet formulas (CSV injection: =, +, -, @). */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Worker: pages through all tickets, writes a private CSV, emails the requester. */
export async function processExport(exportId: string): Promise<void> {
  const exp = await prisma.export.findUnique({
    where: { id: exportId },
    include: { event: true, requester: true },
  });
  if (!exp || exp.status === "ready") return;
  await prisma.export.update({ where: { id: exportId }, data: { status: "processing" } });

  try {
    const header = [
      "ticket_code",
      "ticket_type",
      "status",
      "name",
      "email",
      "buyer_name",
      "buyer_email",
      "buyer_phone",
      "booking_code",
      "price",
      "currency",
      "checked_in_at",
      "issued_at",
    ];
    const lines = [header.join(",")];
    let after: string | undefined;
    for (;;) {
      const rows = await prisma.ticket.findMany({
        where: { eventId: exp.eventId, ...(after ? { id: { gt: after } } : {}) },
        include: attendeeInclude,
        orderBy: { id: "asc" },
        take: 1000,
      });
      if (rows.length === 0) break;
      for (const r of rows.map(toAttendee)) {
        lines.push(
          [
            r.ticketCode,
            r.ticketType,
            r.status,
            r.name,
            r.email,
            r.buyer.name,
            r.buyer.email,
            r.buyer.phone,
            r.bookingCode,
            (r.price / 100).toFixed(2),
            r.currency,
            r.checkedInAt,
            r.issuedAt,
          ]
            .map(csvField)
            .join(","),
        );
      }
      after = rows.at(-1)!.id;
    }
    const key = `exports/${exp.eventId}/${exp.id}.csv`;
    // BOM so Excel opens UTF-8 names (Devanagari etc.) correctly
    await putObject(
      key,
      Buffer.from("﻿" + lines.join("\r\n"), "utf8"),
      "text/csv; charset=utf-8",
      "private, no-store",
    );
    const rowCount = lines.length - 1;
    const notificationId = await prisma.$transaction(async (tx) => {
      await tx.export.update({
        where: { id: exportId },
        data: { status: "ready", objectKey: key, rowCount, completedAt: new Date(), error: null },
      });
      return queueEmail(tx, {
        userId: exp.requestedBy,
        to: exp.requester.email,
        type: "export.ready",
        payload: { name: exp.requester.fullName, eventTitle: exp.event.title, rowCount, exportId },
      });
    });
    await dispatch([notificationId]);
    log.info({ exportId, rowCount }, "export.ready");
  } catch (err) {
    await prisma.export.update({
      where: { id: exportId },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 500) : "failed",
      },
    });
    throw err;
  }
}
