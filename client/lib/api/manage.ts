import { api, qs } from "./client";
import type { EventCard, EventMetadata, EventMode, EventStatus, PublicEvent, PublicTicketType, Venue } from "./events";
import type { Page } from "./pagination";

// Organizer-side event management. Shapes mirror server/src/modules/events/events.dto.ts
// (manage views), promo-codes.service.ts and tickets/attendees.service.ts + checkins.service.ts.

export type Visibility = "public" | "unlisted" | "private";

export interface ManageTicketType extends PublicTicketType {
  quantityTotal: number;
  quantityReserved: number;
  quantitySold: number;
  isActive: boolean;
  sortOrder: number;
  version: number;
}

export interface ManageEvent extends Omit<PublicEvent, "ticketTypes"> {
  visibility: Visibility;
  onlineUrl: string | null;
  coverUploadId: string | null;
  categoryId: string | null;
  venueId: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  ticketTypes: ManageTicketType[];
  refundProgress?: { remaining: number; refunded: number; cancelled: number };
}

/** Row of GET /me/events. */
export interface MyEventRow extends EventCard {
  status: EventStatus;
  visibility: Visibility;
  version: number;
  publishedAt: string | null;
  ticketsSold: number;
  ticketsTotal: number;
}

export interface VenueOption extends Venue {
  hasSeatMap: boolean;
  /** shared platform venue (true) or one of your own (false) */
  platform: boolean;
}

export interface EventInput {
  title: string;
  slug?: string;
  summary?: string | null;
  description?: string | null;
  categoryId?: string | null;
  venueId?: string | null;
  coverUploadId?: string | null;
  mode: EventMode;
  onlineUrl?: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  visibility?: Visibility;
  metadata?: EventMetadata;
}

export interface TicketTypeInput {
  name: string;
  description?: string | null;
  price: number; // paisa
  quantityTotal: number;
  minPerOrder: number;
  maxPerOrder: number;
  salesStartAt?: string | null;
  salesEndAt?: string | null;
  isActive: boolean;
}

export interface VenueInput {
  name: string;
  addressLine?: string;
  city: string;
  capacity?: number;
}

export interface PromoCode {
  id: string;
  code: string;
  /** null = organizer-wide code (works for all your events) */
  eventId: string | null;
  discountType: "percent" | "fixed";
  /** percent: 1–100; fixed: paisa */
  discountValue: number;
  maxRedemptions: number | null;
  timesRedeemed: number;
  remaining: number | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface PromoInput {
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  maxRedemptions?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  isActive: boolean;
}

export type AttendeeStatus = "valid" | "checked_in" | "cancelled" | "refunded";

export interface Attendee {
  ticketId: string;
  ticketCode: string;
  ticketType: string;
  status: AttendeeStatus;
  name: string;
  email: string;
  buyer: { name: string; email: string; phone: string | null };
  bookingCode: string;
  price: number;
  currency: string;
  checkedInAt: string | null;
  issuedAt: string;
}

export interface ExportJob {
  id: string;
  eventId?: string;
  status: "queued" | "processing" | "ready" | "failed";
  rowCount?: number | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
  downloadUrl?: string | null;
}

export type StaffRole = "scanner" | "manager";

export interface StaffMember {
  userId: string;
  fullName: string;
  email: string;
  role: StaffRole;
  addedAt: string;
}

export interface CheckInStats {
  eventId: string;
  issued: number;
  checkedIn: number;
  remaining: number;
  byTicketType: { ticketTypeId: string; name: string; issued: number; checkedIn: number; remaining: number }[];
}

const enc = encodeURIComponent;
/** The API's ETag is `"v{version}"`; the version is also in every manage body. */
const ifMatch = (version: number) => ({ "If-Match": `"v${version}"` });

export const manageApi = {
  myEvents: (p: { status?: EventStatus; cursor?: string; limit?: number }) =>
    api<Page<MyEventRow>>(`/me/events${qs(p)}`),

  /** Owners and admins get the manage view; anyone else gets the public one (no `version`). */
  event: (id: string) => api<{ event: ManageEvent | PublicEvent }>(`/events/${enc(id)}`),
  create: (body: EventInput) => api<{ event: ManageEvent }>("/events", { method: "POST", body }),
  update: (id: string, version: number, body: Partial<EventInput>) =>
    api<{ event: ManageEvent }>(`/events/${enc(id)}`, { method: "PATCH", body, headers: ifMatch(version) }),
  remove: (id: string) => api<void>(`/events/${enc(id)}`, { method: "DELETE" }),
  publish: (id: string) => api<{ event: ManageEvent }>(`/events/${enc(id)}/publish`, { method: "POST" }),
  cancel: (id: string, reason: string) =>
    api<{ event: ManageEvent }>(`/events/${enc(id)}/cancel`, { method: "POST", body: { reason } }),

  createTicketType: (id: string, body: TicketTypeInput) =>
    api<{ ticketType: ManageTicketType }>(`/events/${enc(id)}/ticket-types`, { method: "POST", body }),
  updateTicketType: (id: string, ttId: string, version: number, body: Partial<TicketTypeInput>) =>
    api<{ ticketType: ManageTicketType }>(`/events/${enc(id)}/ticket-types/${enc(ttId)}`, {
      method: "PATCH",
      body,
      headers: ifMatch(version),
    }),
  deleteTicketType: (id: string, ttId: string) =>
    api<void>(`/events/${enc(id)}/ticket-types/${enc(ttId)}`, { method: "DELETE" }),

  venues: (p: { q?: string; city?: string; mine?: boolean }) => api<{ data: VenueOption[] }>(`/venues${qs(p)}`),
  createVenue: (body: VenueInput) => api<{ venue: VenueOption }>("/venues", { method: "POST", body }),

  promoCodes: (id: string) => api<{ data: PromoCode[] }>(`/events/${enc(id)}/promo-codes`),
  createPromo: (id: string, body: PromoInput) =>
    api<{ promoCode: PromoCode }>(`/events/${enc(id)}/promo-codes`, { method: "POST", body }),
  updatePromo: (id: string, promoId: string, body: Partial<Omit<PromoInput, "code">>) =>
    api<{ promoCode: PromoCode }>(`/events/${enc(id)}/promo-codes/${enc(promoId)}`, { method: "PATCH", body }),
  deletePromo: (id: string, promoId: string) =>
    api<void>(`/events/${enc(id)}/promo-codes/${enc(promoId)}`, { method: "DELETE" }),

  attendees: (id: string, p: { q?: string; status?: AttendeeStatus; cursor?: string; limit?: number }) =>
    api<Page<Attendee>>(`/events/${enc(id)}/attendees${qs(p)}`),
  requestExport: (id: string) => api<{ export: ExportJob }>(`/events/${enc(id)}/attendees/export`, { method: "POST" }),
  getExport: (exportId: string) => api<{ export: ExportJob }>(`/exports/${enc(exportId)}`),
  checkInStats: (id: string) => api<CheckInStats>(`/events/${enc(id)}/check-ins/stats`),

  staff: (id: string) => api<{ data: StaffMember[] }>(`/events/${enc(id)}/staff`),
  addStaff: (id: string, body: { email: string; role: StaffRole }) =>
    api<{ staff: StaffMember }>(`/events/${enc(id)}/staff`, { method: "POST", body }),
  removeStaff: (id: string, userId: string) =>
    api<void>(`/events/${enc(id)}/staff/${enc(userId)}`, { method: "DELETE" }),
};

export const isManageEvent = (e: ManageEvent | PublicEvent): e is ManageEvent => "version" in e;

export const STATUS: Record<EventStatus, { label: string; tone: "neutral" | "success" | "danger" | "warning" | "dark" }> = {
  draft: { label: "Draft", tone: "warning" },
  published: { label: "Published", tone: "success" },
  completed: { label: "Ended", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const VISIBILITY: Record<Visibility, { label: string; hint: string }> = {
  public: { label: "Public", hint: "Listed in search and on your organizer page." },
  unlisted: { label: "Unlisted", hint: "Anyone with the link can book; never listed." },
  private: { label: "Private", hint: "Only you can see it." },
};

/** Cancelled and completed events can't be edited. */
export const isReadOnly = (e: { status: EventStatus }) => e.status === "cancelled" || e.status === "completed";

/** Tickets sold or held: price is locked and the type can't be deleted. */
export const hasSales = (t: ManageTicketType) => t.quantitySold + t.quantityReserved > 0;
