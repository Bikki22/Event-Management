import type {
  Prisma,
  Category,
  Event,
  OrganizerProfile,
  TicketType,
  Upload,
  Venue,
} from "../../generated/prisma/client.js";
import { variantsOf, type ImageVariants } from "../uploads/uploads.dto.js";
import { toVenueDto, type VenueDto } from "../venues/venues.dto.js";

export type FullEvent = Event & {
  category: Category | null;
  venue: Venue | null;
  organizer: OrganizerProfile;
  cover: Upload | null;
  ticketTypes: TicketType[];
};

export const fullEventInclude = {
  category: true,
  venue: true,
  organizer: true,
  cover: true,
  ticketTypes: { orderBy: [{ sortOrder: "asc" }, { price: "asc" }, { id: "asc" }] },
} satisfies Prisma.EventInclude;

// ───────────── ticket types ─────────────

const available = (t: TicketType) => t.quantityTotal - t.quantityReserved - t.quantitySold;

const isOnSale = (t: TicketType, e: Event, now = new Date()) =>
  e.status === "published" &&
  t.isActive &&
  available(t) > 0 &&
  (!t.salesStartAt || t.salesStartAt <= now) &&
  (!t.salesEndAt || t.salesEndAt > now) &&
  e.endsAt > now;

/** Buyers see availability, never the raw reserved/sold counts. */
export interface PublicTicketTypeDto {
  id: string;
  name: string;
  description: string | null;
  price: number; // minor units
  currency: string;
  minPerOrder: number;
  maxPerOrder: number;
  salesStartAt: string | null;
  salesEndAt: string | null;
  available: number;
  soldOut: boolean;
  onSale: boolean;
}

export const toPublicTicketType = (t: TicketType, e: Event): PublicTicketTypeDto => ({
  id: t.id,
  name: t.name,
  description: t.description,
  price: Number(t.price),
  currency: t.currency,
  minPerOrder: t.minPerOrder,
  maxPerOrder: t.maxPerOrder,
  salesStartAt: t.salesStartAt?.toISOString() ?? null,
  salesEndAt: t.salesEndAt?.toISOString() ?? null,
  available: Math.max(0, available(t)),
  soldOut: available(t) <= 0,
  onSale: isOnSale(t, e),
});

export interface ManageTicketTypeDto extends PublicTicketTypeDto {
  quantityTotal: number;
  quantityReserved: number;
  quantitySold: number;
  isActive: boolean;
  sortOrder: number;
  version: number;
}

export const toManageTicketType = (t: TicketType, e: Event): ManageTicketTypeDto => ({
  ...toPublicTicketType(t, e),
  quantityTotal: t.quantityTotal,
  quantityReserved: t.quantityReserved,
  quantitySold: t.quantitySold,
  isActive: t.isActive,
  sortOrder: t.sortOrder,
  version: t.version,
});

// ───────────── events ─────────────

const organizerSummary = (o: OrganizerProfile) => ({
  orgName: o.orgName,
  slug: o.slug,
  logoUrl: o.logoUrl,
  verified: o.verificationStatus === "verified",
});

const categorySummary = (c: Category | null) =>
  c ? { id: c.id, name: c.name, slug: c.slug } : null;

/** Lowest active price, for "from NPR 500" on cards. */
const priceFrom = (types: TicketType[]) => {
  const prices = types.filter((t) => t.isActive).map((t) => Number(t.price));
  return prices.length ? Math.min(...prices) : null;
};

/** Listing card: small payload, no description. */
export interface EventCardDto {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverImage: ImageVariants | null;
  mode: Event["mode"];
  startsAt: string;
  endsAt: string;
  timezone: string;
  category: { id: string; name: string; slug: string } | null;
  venue: { name: string; city: string } | null;
  organizer: ReturnType<typeof organizerSummary>;
  priceFrom: number | null;
  currency: string;
  soldOut: boolean;
}

export const toEventCard = (e: FullEvent): EventCardDto => {
  const active = e.ticketTypes.filter((t) => t.isActive);
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    summary: e.summary,
    coverImage: variantsOf(e.cover),
    mode: e.mode,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    timezone: e.timezone,
    category: categorySummary(e.category),
    venue: e.venue ? { name: e.venue.name, city: e.venue.city } : null,
    organizer: organizerSummary(e.organizer),
    priceFrom: priceFrom(active),
    currency: active[0]?.currency ?? "NPR",
    soldOut: active.length > 0 && active.every((t) => available(t) <= 0),
  };
};

export interface PublicEventDto extends Omit<EventCardDto, "venue" | "soldOut"> {
  description: string | null;
  seatingType: Event["seatingType"];
  status: Event["status"];
  cancellationReason: string | null;
  metadata: unknown;
  venue: VenueDto | null;
  ticketTypes: PublicTicketTypeDto[];
}

export const toPublicEvent = (e: FullEvent): PublicEventDto => {
  const { soldOut: _soldOut, venue: _venue, ...card } = toEventCard(e);
  return {
    ...card,
    description: e.description,
    seatingType: e.seatingType,
    status: e.status,
    cancellationReason: e.cancellationReason,
    metadata: e.metadata,
    venue: e.venue ? toVenueDto(e.venue) : null,
    ticketTypes: e.ticketTypes.filter((t) => t.isActive).map((t) => toPublicTicketType(t, e)),
  };
};

/** Owner / admin view: everything, including the online link and stock counts. */
export interface ManageEventDto extends Omit<PublicEventDto, "ticketTypes"> {
  visibility: Event["visibility"];
  onlineUrl: string | null;
  coverUploadId: string | null;
  categoryId: string | null;
  venueId: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  ticketTypes: ManageTicketTypeDto[];
  /** only for cancelled events: how far the refund fan-out got */
  refundProgress?: { remaining: number; refunded: number; cancelled: number };
}

export const toManageEvent = (e: FullEvent): ManageEventDto => ({
  ...toPublicEvent(e),
  visibility: e.visibility,
  onlineUrl: e.onlineUrl,
  coverUploadId: e.coverUploadId,
  categoryId: e.categoryId,
  venueId: e.venueId,
  publishedAt: e.publishedAt?.toISOString() ?? null,
  cancelledAt: e.cancelledAt?.toISOString() ?? null,
  version: e.version,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
  ticketTypes: e.ticketTypes.map((t) => toManageTicketType(t, e)),
});
