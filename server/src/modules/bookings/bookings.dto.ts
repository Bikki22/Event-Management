import type {
  Booking,
  BookingItem,
  Event,
  Ticket,
  TicketType,
  Upload,
} from "../../generated/prisma/client.js";
import { variantsOf } from "../uploads/uploads.dto.js";

export type FullBooking = Booking & {
  event: Event & { cover: Upload | null };
  items: (BookingItem & { ticketType: TicketType; tickets: Ticket[] })[];
};

export const fullBookingInclude = {
  event: { include: { cover: true } },
  items: {
    include: { ticketType: true, tickets: { orderBy: { id: "asc" } } },
    orderBy: { ticketTypeId: "asc" },
  },
} as const;

/** Amounts are minor units (paisa). */
export const toBookingDto = (b: FullBooking, opts: { includeContact?: boolean } = {}) => ({
  id: b.id,
  bookingCode: b.bookingCode,
  status: b.status,
  event: {
    id: b.event.id,
    slug: b.event.slug,
    title: b.event.title,
    startsAt: b.event.startsAt.toISOString(),
    endsAt: b.event.endsAt.toISOString(),
    timezone: b.event.timezone,
    coverImage: variantsOf(b.event.cover),
  },
  items: b.items.map((i) => ({
    ticketTypeId: i.ticketTypeId,
    name: i.ticketType.name,
    quantity: i.quantity,
    unitPrice: Number(i.unitPrice),
    lineTotal: Number(i.lineTotal),
  })),
  subtotal: Number(b.subtotal),
  discountAmount: Number(b.discountAmount),
  feeAmount: Number(b.feeAmount),
  totalAmount: Number(b.totalAmount),
  currency: b.currency,
  // only meaningful while pending: pay before this or the hold is released
  expiresAt: b.status === "pending" ? b.expiresAt.toISOString() : null,
  confirmedAt: b.confirmedAt?.toISOString() ?? null,
  cancelledAt: b.cancelledAt?.toISOString() ?? null,
  createdAt: b.createdAt.toISOString(),
  tickets: b.items.flatMap((i) =>
    i.tickets.map((t) => ({
      id: t.id,
      ticketCode: t.ticketCode,
      ticketType: i.ticketType.name,
      status: t.status,
      holderName: t.holderName,
    })),
  ),
  ...(opts.includeContact ? { contact: { email: b.contactEmail, phone: b.contactPhone } } : {}),
});

export type BookingDto = ReturnType<typeof toBookingDto>;
