import { z } from "zod";
import { SLUG_PATTERN } from "../../lib/slug.js";

export const EVENT_SLUG_MAX = 80;
/**
 * Any IANA zone or alias Intl accepts. Not `Intl.supportedValuesOf`: it lists only ICU's canonical
 * names, so it rejected "Asia/Kathmandu" (it has "Asia/Katmandu") and "Asia/Kolkata".
 */
const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const dateTime = z.iso
  .datetime({ offset: true, error: "Use an ISO 8601 date-time, e.g. 2026-12-20T18:00:00+05:45" })
  .transform((s) => new Date(s));

const fields = {
  title: z.string().trim().min(3).max(150),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(EVENT_SLUG_MAX)
    .regex(SLUG_PATTERN, { error: "Use lowercase letters, numbers and single hyphens" }),
  summary: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(20_000),
  categoryId: z.uuid(),
  venueId: z.uuid(),
  coverUploadId: z.uuid(),
  mode: z.enum(["in_person", "online", "hybrid"]),
  onlineUrl: z.url({ protocol: /^https$/, error: "Online link must be an https URL" }).max(500),
  seatingType: z.enum(["general_admission", "reserved"]),
  timezone: z.string().max(64).refine(isTimeZone, { error: "Unknown time zone" }),
  visibility: z.enum(["public", "unlisted", "private"]),
  metadata: z
    .object({
      tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
      faqs: z
        .array(
          z
            .object({
              question: z.string().trim().min(1).max(200),
              answer: z.string().trim().min(1).max(2000),
            })
            .strict(),
        )
        .max(20)
        .optional(),
    })
    .strict(),
};

export const createEventBody = z
  .object({
    title: fields.title,
    slug: fields.slug.optional(), // generated from the title when omitted
    summary: fields.summary.optional(),
    description: fields.description.optional(),
    categoryId: fields.categoryId.optional(),
    venueId: fields.venueId.optional(),
    coverUploadId: fields.coverUploadId.optional(),
    mode: fields.mode,
    onlineUrl: fields.onlineUrl.optional(),
    seatingType: fields.seatingType.default("general_admission"),
    startsAt: dateTime,
    endsAt: dateTime,
    timezone: fields.timezone.default("Asia/Kathmandu"),
    visibility: fields.visibility.default("public"),
    metadata: fields.metadata.optional(),
  })
  .strict();

// status, organizer, publishedAt... change only through dedicated endpoints
export const updateEventBody = z
  .object({
    title: fields.title.optional(),
    slug: fields.slug.optional(),
    summary: fields.summary.nullable().optional(),
    description: fields.description.nullable().optional(),
    categoryId: fields.categoryId.nullable().optional(),
    venueId: fields.venueId.nullable().optional(),
    coverUploadId: fields.coverUploadId.nullable().optional(),
    mode: fields.mode.optional(),
    onlineUrl: fields.onlineUrl.nullable().optional(),
    seatingType: fields.seatingType.optional(),
    startsAt: dateTime.optional(),
    endsAt: dateTime.optional(),
    timezone: fields.timezone.optional(),
    visibility: fields.visibility.optional(),
    metadata: fields.metadata.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Provide at least one field to update" });

export const cancelEventBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const eventIdParams = z.object({ id: z.uuid() });
export const eventRefParams = z.object({ idOrSlug: z.string().trim().min(1).max(EVENT_SLUG_MAX) });

const dateOrDateTime = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((s) => new Date(s));

export const listEventsQuery = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().toLowerCase().max(60).optional(), // slug; includes sub-categories
    city: z.string().trim().min(1).max(80).optional(),
    mode: fields.mode.optional(),
    organizer: z.string().trim().toLowerCase().max(60).optional(), // organizer slug
    from: dateOrDateTime.optional(),
    to: dateOrDateTime.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(300).optional(),
  })
  .strict();

export const myEventsQuery = z
  .object({
    status: z.enum(["draft", "published", "cancelled", "completed"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(300).optional(),
  })
  .strict();

// ───────────── ticket types ─────────────

const ticketFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  // minor units (paisa): 150000 = NPR 1,500.00
  price: z.number().int().min(0).max(100_000_000_00),
  quantityTotal: z.number().int().min(1).max(1_000_000),
  perOrder: z.number().int().min(1).max(50),
  sortOrder: z.number().int().min(0).max(10_000),
};

const perOrderValid = (v: { minPerOrder?: number; maxPerOrder?: number }) =>
  v.minPerOrder === undefined || v.maxPerOrder === undefined || v.minPerOrder <= v.maxPerOrder;
const salesWindowValid = (v: { salesStartAt?: Date | null; salesEndAt?: Date | null }) =>
  !v.salesStartAt || !v.salesEndAt || v.salesEndAt > v.salesStartAt;

export const createTicketTypeBody = z
  .object({
    name: ticketFields.name,
    description: ticketFields.description.optional(),
    price: ticketFields.price,
    quantityTotal: ticketFields.quantityTotal,
    minPerOrder: ticketFields.perOrder.default(1),
    maxPerOrder: ticketFields.perOrder.default(10),
    salesStartAt: dateTime.optional(),
    salesEndAt: dateTime.optional(),
    isActive: z.boolean().default(true),
    sortOrder: ticketFields.sortOrder.default(0),
  })
  .strict()
  .refine(perOrderValid, { path: ["maxPerOrder"], error: "Must be ≥ minPerOrder" })
  .refine(salesWindowValid, { path: ["salesEndAt"], error: "Must be after salesStartAt" });

export const updateTicketTypeBody = z
  .object({
    name: ticketFields.name.optional(),
    description: ticketFields.description.nullable().optional(),
    price: ticketFields.price.optional(),
    quantityTotal: ticketFields.quantityTotal.optional(),
    minPerOrder: ticketFields.perOrder.optional(),
    maxPerOrder: ticketFields.perOrder.optional(),
    salesStartAt: dateTime.nullable().optional(),
    salesEndAt: dateTime.nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: ticketFields.sortOrder.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Provide at least one field to update" })
  .refine(perOrderValid, { path: ["maxPerOrder"], error: "Must be ≥ minPerOrder" })
  .refine(salesWindowValid, { path: ["salesEndAt"], error: "Must be after salesStartAt" });

export const ticketTypeParams = z.object({ id: z.uuid(), ttId: z.uuid() });

export type CreateEventBody = z.infer<typeof createEventBody>;
export type UpdateEventBody = z.infer<typeof updateEventBody>;
export type ListEventsQuery = z.infer<typeof listEventsQuery>;
export type MyEventsQuery = z.infer<typeof myEventsQuery>;
export type CreateTicketTypeBody = z.infer<typeof createTicketTypeBody>;
export type UpdateTicketTypeBody = z.infer<typeof updateTicketTypeBody>;
