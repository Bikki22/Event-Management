import { z } from "zod";
import { toPaisa } from "@/lib/format";

// Mirrors server/src/modules/events/events.schemas.ts, venues.schemas.ts, promo-codes.service.ts
// and tickets.schemas.ts. Dates are datetime-local strings here; they're converted to ISO
// (in the event's time zone) when the request is built.

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, { error: "Pick a date and time" });
const optionalLocal = z.string().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v), {
  error: "Pick a date and time",
});
const money = z.string().trim().refine((v) => toPaisa(v) !== null, { error: "Enter an amount like 1500 or 1500.50" });
const int = (min: number, max: number, label = "a number") =>
  z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && +v >= min && +v <= max, { error: `Enter ${label} from ${min} to ${max}` });

export const basicsSchema = z.object({
  title: z.string().trim().min(3, { error: "Use at least 3 characters" }).max(150),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || (v.length >= 3 && v.length <= 80), { error: "Use 3–80 characters" })
    .refine((v) => v === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), {
      error: "Lowercase letters, numbers and single hyphens only",
    }),
  summary: z.string().trim().max(300, { error: "Keep it under 300 characters" }),
  description: z.string().trim().max(20_000),
  categoryId: z.string(),
  visibility: z.enum(["public", "unlisted", "private"]),
  tags: z
    .string()
    .refine((v) => v.split(",").filter((t) => t.trim()).length <= 10, { error: "Up to 10 tags" })
    .refine((v) => v.split(",").every((t) => t.trim().length <= 30), { error: "Each tag can be up to 30 characters" }),
});
export type BasicsValues = z.infer<typeof basicsSchema>;

export const scheduleSchema = z
  .object({
    mode: z.enum(["in_person", "online", "hybrid"]),
    venueId: z.string(),
    onlineUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https:\/\/\S+\.\S+/.test(v), { error: "Use a full https:// link" }),
    timezone: z.string().min(1),
    startsAt: localDateTime,
    endsAt: localDateTime,
  })
  .refine((v) => v.mode === "online" || v.venueId !== "", { path: ["venueId"], error: "Pick a venue" })
  .refine((v) => v.endsAt > v.startsAt, { path: ["endsAt"], error: "Must be after the start" });
export type ScheduleValues = z.infer<typeof scheduleSchema>;

export const ticketTypeSchema = z
  .object({
    name: z.string().trim().min(1, { error: "Give it a name, e.g. General" }).max(80),
    description: z.string().trim().max(500),
    price: money,
    quantityTotal: int(1, 1_000_000, "a quantity"),
    minPerOrder: int(1, 50),
    maxPerOrder: int(1, 50),
    salesStartAt: optionalLocal,
    salesEndAt: optionalLocal,
    isActive: z.boolean(),
  })
  .refine((v) => !/^\d+$/.test(v.minPerOrder) || !/^\d+$/.test(v.maxPerOrder) || +v.minPerOrder <= +v.maxPerOrder, {
    path: ["maxPerOrder"],
    error: "Must be at least the minimum",
  })
  .refine((v) => !v.salesStartAt || !v.salesEndAt || v.salesEndAt > v.salesStartAt, {
    path: ["salesEndAt"],
    error: "Must be after the sales start",
  });
export type TicketTypeValues = z.infer<typeof ticketTypeSchema>;

export const venueSchema = z.object({
  name: z.string().trim().min(2, { error: "Use at least 2 characters" }).max(120),
  addressLine: z.string().trim().max(200).refine((v) => v === "" || v.length >= 2, { error: "Too short" }),
  city: z.string().trim().min(2, { error: "Enter the city" }).max(80),
  capacity: z.string().trim().refine((v) => v === "" || (/^\d+$/.test(v) && +v >= 1 && +v <= 1_000_000), {
    error: "Enter a whole number",
  }),
});
export type VenueValues = z.infer<typeof venueSchema>;

export const promoSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/, { error: "3–32 letters, digits, _ or -" }),
    discountType: z.enum(["percent", "fixed"]),
    discountValue: z.string().trim(),
    maxRedemptions: z.string().trim().refine((v) => v === "" || (/^\d+$/.test(v) && +v >= 1 && +v <= 1_000_000), {
      error: "Enter a whole number, or leave empty for no limit",
    }),
    validFrom: optionalLocal,
    validUntil: optionalLocal,
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.discountType === "percent") {
      if (!/^\d+$/.test(v.discountValue) || +v.discountValue < 1 || +v.discountValue > 100) {
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Enter a percentage from 1 to 100" });
      }
    } else {
      const p = toPaisa(v.discountValue);
      if (p === null || p < 1) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Enter an amount like 500" });
    }
    if (v.validFrom && v.validUntil && v.validUntil <= v.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Must be after the start" });
    }
  });
export type PromoValues = z.infer<typeof promoSchema>;

export const staffSchema = z.object({
  email: z.email({ error: "Enter a valid email" }).trim().toLowerCase().max(254),
  role: z.enum(["scanner", "manager"]),
});
export type StaffValues = z.infer<typeof staffSchema>;

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, { error: "Tell ticket holders why (at least 3 characters)" }).max(500),
  confirm: z.string(),
});
export type CancelValues = z.infer<typeof cancelSchema>;

/** "1500" → "1500"; paisa → NPR string for inputs (150050 → "1500.50"). */
export const paisaToInput = (paisa: number) => (paisa % 100 === 0 ? String(paisa / 100) : (paisa / 100).toFixed(2));

export const splitTags = (v: string) =>
  [...new Set(v.split(",").map((t) => t.trim()).filter(Boolean))];
