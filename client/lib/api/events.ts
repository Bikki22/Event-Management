import { api, qs } from "./client";
import type { Page } from "./pagination";

// Shapes mirror server/src/modules/events/events.dto.ts (public views only).

export type EventMode = "in_person" | "online" | "hybrid";
export type EventStatus = "draft" | "published" | "cancelled" | "completed";

export interface ImageVariants {
  sm: string; // 400×225
  md: string; // 800×450
  lg: string; // 1600×900
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
}

export interface OrganizerSummary {
  orgName: string;
  slug: string;
  logoUrl: string | null;
  verified: boolean;
}

export interface EventCard {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverImage: ImageVariants | null;
  mode: EventMode;
  startsAt: string;
  endsAt: string;
  timezone: string;
  category: CategorySummary | null;
  venue: { name: string; city: string } | null;
  organizer: OrganizerSummary;
  /** lowest active price in paisa; null when there are no ticket types */
  priceFrom: number | null;
  currency: string;
  soldOut: boolean;
}

export interface Venue {
  id: string;
  name: string;
  addressLine: string | null;
  city: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
}

export interface PublicTicketType {
  id: string;
  name: string;
  description: string | null;
  price: number; // paisa
  currency: string;
  minPerOrder: number;
  maxPerOrder: number;
  salesStartAt: string | null;
  salesEndAt: string | null;
  available: number;
  soldOut: boolean;
  onSale: boolean;
}

export interface EventMetadata {
  tags?: string[];
  faqs?: { question: string; answer: string }[];
}

export interface PublicEvent extends Omit<EventCard, "venue" | "soldOut"> {
  description: string | null;
  seatingType: "general_admission" | "reserved";
  status: EventStatus;
  cancellationReason: string | null;
  metadata: EventMetadata;
  venue: Venue | null;
  ticketTypes: PublicTicketType[];
}

export interface Availability {
  eventId: string;
  status: EventStatus;
  ticketTypes: { ticketTypeId: string; available: number; soldOut: boolean; onSale: boolean }[];
}

/** Query params accepted by GET /events (see listEventsQuery on the server). */
export interface EventFilters {
  q?: string;
  category?: string;
  city?: string;
  mode?: EventMode;
  organizer?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export const eventsApi = {
  list: (filters: EventFilters & { cursor?: string }) =>
    api<Page<EventCard>>(`/events${qs({ ...filters })}`, { auth: false }),

  get: (idOrSlug: string) => api<{ event: PublicEvent }>(`/events/${encodeURIComponent(idOrSlug)}`, { auth: false }),

  availability: (id: string) => api<Availability>(`/events/${encodeURIComponent(id)}/availability`, { auth: false }),
};

export const MODE_LABEL: Record<EventMode, string> = {
  in_person: "In person",
  online: "Online",
  hybrid: "In person + online",
};
