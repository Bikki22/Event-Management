import type { Job } from "bullmq";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { putObject } from "../../lib/storage.js";
import { formatMoney, renderTicketPdf } from "./tickets.pdf.js";
import { enqueueTicketPdfs, type TicketPdfJobData } from "./tickets.service.js";

const log = logger.child({ module: "tickets" });

/**
 * Renders the ticket PDF and stores it privately at tickets/{eventId}/{ticketId}.pdf.
 * If the ticket changed while rendering (holder reassigned → updatedAt moved), the result is
 * discarded: a newer job for the new version is already queued.
 */
export async function generateTicketPdf(job: Job<TicketPdfJobData>): Promise<void> {
  const t = await prisma.ticket.findUnique({
    where: { id: job.data.ticketId },
    include: {
      ticketType: true,
      event: { include: { venue: true, organizer: true } },
      bookingItem: { include: { booking: { include: { user: true } } } },
    },
  });
  if (!t || (t.status !== "valid" && t.status !== "checked_in")) return;
  if (t.pdfKey) return; // already rendered for this version

  const booking = t.bookingItem.booking;
  const v = t.event.venue;
  const pdf = await renderTicketPdf({
    ticketCode: t.ticketCode,
    ticketType: t.ticketType.name,
    holderName: t.holderName ?? booking.user.fullName,
    bookingCode: booking.bookingCode,
    eventTitle: t.event.title,
    startsAt: t.event.startsAt,
    endsAt: t.event.endsAt,
    timezone: t.event.timezone,
    mode: t.event.mode,
    venue: v ? [v.name, v.addressLine, v.city].filter(Boolean).join(", ") : null,
    organizer: t.event.organizer.orgName,
    price: formatMoney(Number(t.bookingItem.unitPrice), booking.currency),
  });

  const key = `tickets/${t.eventId}/${t.id}-${t.updatedAt.getTime()}.pdf`;
  await putObject(key, pdf, "application/pdf", "private, no-store");
  const { count } = await prisma.ticket.updateMany({
    where: { id: t.id, updatedAt: t.updatedAt, pdfKey: null },
    data: { pdfKey: key, pdfGeneratedAt: new Date() },
  });
  log.info({ ticketId: t.id, bytes: pdf.length, stored: count === 1 }, "ticket.pdf_generated");
}

/** Maintenance safety net: valid tickets still without a PDF a couple of minutes after issue. */
export async function sweepMissingPdfs(batch = 200): Promise<number> {
  const missing = await prisma.ticket.findMany({
    where: {
      pdfKey: null,
      status: { in: ["valid", "checked_in"] },
      updatedAt: { lt: new Date(Date.now() - 120_000) },
    },
    select: { id: true, updatedAt: true },
    take: batch,
  });
  await enqueueTicketPdfs(missing);
  return missing.length;
}
