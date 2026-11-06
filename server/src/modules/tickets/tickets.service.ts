import type { BookingItem, Prisma } from "../../generated/prisma/client.js";
import { newTicketCode } from "../../lib/codes.js";
import { AppError, Conflict, NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { decodeCursor, toPage } from "../../lib/pagination.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import { getQueue } from "../../lib/queue.js";
import { signedDownloadUrl } from "../../lib/storage.js";
import { variantsOf } from "../uploads/uploads.dto.js";
import { toVenueDto } from "../venues/venues.dto.js";
import { qrSvg } from "./tickets.pdf.js";
import type { HolderBody, MyTicketsQuery } from "./tickets.schemas.js";

const log = logger.child({ module: "tickets" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PDF_LINK_SECONDS = 300;

export interface TicketPdfJobData {
  ticketId: string;
}

// ───────────── issuance (called by bookings.confirmInTx) ─────────────

/** One ticket per admission, inside the confirming transaction. */
export async function issueTickets(
  tx: DbOrTx,
  eventId: string,
  items: Pick<BookingItem, "id" | "ticketTypeId" | "quantity">[],
) {
  const data = items.flatMap((item) =>
    Array.from({ length: item.quantity }, () => ({
      ticketCode: newTicketCode(),
      bookingItemId: item.id,
      eventId,
      ticketTypeId: item.ticketTypeId,
    })),
  );
  return tx.ticket.createManyAndReturn({ data, select: { id: true, updatedAt: true } });
}

/**
 * Queue PDF generation. The job id includes updatedAt, so a holder change (which bumps updatedAt)
 * queues a fresh render while duplicates of the same version are ignored.
 */
export async function enqueueTicketPdfs(tickets: { id: string; updatedAt: Date }[]): Promise<void> {
  if (tickets.length === 0) return;
  try {
    await getQueue("tickets").addBulk(
      tickets.map((t) => ({
        name: "pdf",
        data: { ticketId: t.id } satisfies TicketPdfJobData,
        opts: {
          jobId: `pdf-${t.id}-${t.updatedAt.getTime()}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 10_000 },
        },
      })),
    );
  } catch (err) {
    log.warn({ err }, "ticket PDF jobs not queued; the sweep will pick them up");
  }
}

// ───────────── owner views ─────────────

const ticketInclude = {
  ticketType: true,
  event: { include: { venue: true, organizer: true, cover: true } },
  bookingItem: { include: { booking: true } },
} as const;

type FullTicket = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

/** Tickets belong to the person who booked them (they can assign a guest as holder). */
async function findOwned(userId: string, id: string): Promise<FullTicket> {
  const t = await prisma.ticket.findUnique({ where: { id }, include: ticketInclude });
  if (!t || t.bookingItem.booking.userId !== userId) throw NotFound("Ticket");
  return t;
}

const usable = (t: { status: string }) => t.status === "valid" || t.status === "checked_in";

function toTicketSummary(t: FullTicket) {
  return {
    id: t.id,
    ticketCode: t.ticketCode,
    status: t.status,
    ticketType: { id: t.ticketType.id, name: t.ticketType.name },
    holderName: t.holderName,
    holderEmail: t.holderEmail,
    checkedInAt: t.checkedInAt?.toISOString() ?? null,
    bookingCode: t.bookingItem.booking.bookingCode,
    event: {
      id: t.event.id,
      slug: t.event.slug,
      title: t.event.title,
      status: t.event.status,
      mode: t.event.mode,
      startsAt: t.event.startsAt.toISOString(),
      endsAt: t.event.endsAt.toISOString(),
      timezone: t.event.timezone,
      coverImage: variantsOf(t.event.cover),
      venue: t.event.venue ? { name: t.event.venue.name, city: t.event.venue.city } : null,
    },
    pdfReady: t.pdfKey !== null,
  };
}

const isIdCursor = (v: unknown): v is { id: string } =>
  typeof (v as { id?: unknown } | null)?.id === "string" && UUID.test((v as { id: string }).id);

/** My tickets; `upcoming=true` hides events that already ended. */
export async function listMine(userId: string, query: MyTicketsQuery) {
  const afterId = query.cursor ? decodeCursor(query.cursor, isIdCursor).id : undefined;
  const rows = await prisma.ticket.findMany({
    where: {
      bookingItem: { booking: { userId } },
      ...(query.upcoming ? { event: { endsAt: { gt: new Date() } } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(afterId ? { id: { lt: afterId } } : {}),
    },
    include: ticketInclude,
    orderBy: { id: "desc" },
    take: query.limit + 1,
  });
  return toPage(rows, query.limit, toTicketSummary, (t) => ({ id: t.id }));
}

/**
 * Full ticket with the QR (payload + ready-to-render SVG). Holders of a usable ticket also get
 * the online link (it's hidden from the public event page).
 */
export async function get(userId: string, id: string) {
  const t = await findOwned(userId, id);
  return {
    ...toTicketSummary(t),
    qr: { payload: t.ticketCode, svg: await qrSvg(t.ticketCode) },
    event: {
      ...toTicketSummary(t).event,
      venue: t.event.venue ? toVenueDto(t.event.venue) : null,
      onlineUrl: usable(t) && t.event.mode !== "in_person" ? t.event.onlineUrl : null,
      organizer: { orgName: t.event.organizer.orgName, slug: t.event.organizer.slug },
    },
  };
}

/** Give a ticket to a guest (name shown on the PDF and to the scanner). Before the event only. */
export async function setHolder(userId: string, id: string, input: HolderBody) {
  const t = await findOwned(userId, id);
  if (t.status !== "valid") {
    throw Conflict(
      "TICKET_NOT_TRANSFERABLE",
      `A ${t.status.replace("_", "-")} ticket can't be reassigned`,
    );
  }
  if (t.event.startsAt <= new Date()) {
    throw Conflict(
      "TICKET_NOT_TRANSFERABLE",
      "The event has started; tickets can't be reassigned now",
    );
  }
  // clearing pdfKey makes the old PDF unreachable; a new one is rendered with the new name
  const updated = await prisma.ticket.update({
    where: { id },
    data: {
      holderName: input.holderName,
      holderEmail: input.holderEmail ?? null,
      pdfKey: null,
      pdfGeneratedAt: null,
    },
  });
  await enqueueTicketPdfs([updated]);
  log.info({ ticketId: id }, "ticket.holder_changed");
  return get(userId, id);
}

/** Short-lived signed link to the private PDF. 409 while it's still being rendered. */
export async function pdfLink(userId: string, id: string): Promise<string> {
  const t = await findOwned(userId, id);
  if (!usable(t)) throw Conflict("TICKET_NOT_USABLE", `This ticket is ${t.status}`);
  if (!t.pdfKey) {
    await enqueueTicketPdfs([t]); // no-op if already queued
    throw new AppError(
      409,
      "PDF_NOT_READY",
      "The ticket PDF is being generated, try again in a few seconds",
    );
  }
  return signedDownloadUrl(t.pdfKey, {
    expiresInSeconds: PDF_LINK_SECONDS,
    filename: `${t.event.slug}-${t.ticketCode}.pdf`,
  });
}
