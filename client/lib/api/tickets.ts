import { api, qs } from "./client";
import type { EventMode, EventStatus, ImageVariants, Venue } from "./events";
import type { Page } from "./pagination";

// Shapes mirror server/src/modules/tickets/tickets.service.ts (toTicketSummary / get).

export type TicketStatus = "valid" | "checked_in" | "cancelled" | "refunded";

export interface TicketSummary {
  id: string;
  ticketCode: string;
  status: TicketStatus;
  ticketType: { id: string; name: string };
  holderName: string | null;
  holderEmail: string | null;
  checkedInAt: string | null;
  bookingCode: string;
  event: {
    id: string;
    slug: string;
    title: string;
    status: EventStatus;
    mode: EventMode;
    startsAt: string;
    endsAt: string;
    timezone: string;
    coverImage: ImageVariants | null;
    venue: { name: string; city: string } | null;
  };
  /** the worker has rendered the PDF */
  pdfReady: boolean;
}

export interface TicketDetail extends Omit<TicketSummary, "event"> {
  qr: { payload: string; svg: string };
  event: Omit<TicketSummary["event"], "venue"> & {
    venue: Venue | null;
    /** only for usable tickets of online/hybrid events */
    onlineUrl: string | null;
    organizer: { orgName: string; slug: string };
  };
}

export interface TicketListFilter {
  upcoming?: boolean;
  status?: TicketStatus;
}

export const ticketsApi = {
  mine: (filter: TicketListFilter & { cursor?: string; limit?: number }) =>
    api<Page<TicketSummary>>(`/me/tickets${qs({ ...filter, limit: filter.limit ?? 20 })}`),

  get: (id: string) => api<{ ticket: TicketDetail }>(`/tickets/${encodeURIComponent(id)}`),

  setHolder: (id: string, body: { holderName: string; holderEmail?: string | null }) =>
    api<{ ticket: TicketDetail }>(`/tickets/${encodeURIComponent(id)}/holder`, { method: "PATCH", body }),

  /** 5-minute signed link to the private PDF; 409 PDF_NOT_READY while the worker renders it. */
  pdfLink: (id: string) =>
    api<{ url: string; expiresInSeconds: number }>(`/tickets/${encodeURIComponent(id)}/pdf?redirect=false`),
};

export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: "success" | "neutral" | "danger" | "warning" }> = {
  valid: { label: "Valid", tone: "success" },
  checked_in: { label: "Used", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
  refunded: { label: "Refunded", tone: "warning" },
};
