import { z } from "zod";
import type { PromoCode } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import {
  AppError,
  Conflict,
  isUniqueViolation,
  NotFound,
  Unprocessable,
} from "../../lib/errors.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import type { AuthContext } from "../../middleware/auth.js";

// ───────────── schemas ─────────────

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, { error: "3-32 letters, digits, _ or -" });
const dateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const valueValid = (v: { discountType?: string; discountValue?: number }) =>
  v.discountType !== "percent" ||
  v.discountValue === undefined ||
  (v.discountValue >= 1 && v.discountValue <= 100);
const windowValid = (v: { validFrom?: Date | null; validUntil?: Date | null }) =>
  !v.validFrom || !v.validUntil || v.validUntil > v.validFrom;

export const createPromoBody = z
  .object({
    code,
    discountType: z.enum(["percent", "fixed"]),
    // percent: 1-100; fixed: minor units (paisa), e.g. 50000 = NPR 500
    discountValue: z.number().int().min(1).max(100_000_000_00),
    maxRedemptions: z.number().int().min(1).max(1_000_000).optional(),
    validFrom: dateTime.optional(),
    validUntil: dateTime.optional(),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine(valueValid, { path: ["discountValue"], error: "A percent discount must be 1-100" })
  .refine(windowValid, { path: ["validUntil"], error: "Must be after validFrom" });

export const updatePromoBody = z
  .object({
    discountType: z.enum(["percent", "fixed"]).optional(),
    discountValue: z.number().int().min(1).max(100_000_000_00).optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
    validFrom: dateTime.nullable().optional(),
    validUntil: dateTime.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Provide at least one field to update" })
  .refine(windowValid, { path: ["validUntil"], error: "Must be after validFrom" });

export const validatePromoBody = z
  .object({
    eventId: z.uuid(),
    code,
    items: z
      .array(
        z.object({ ticketTypeId: z.uuid(), quantity: z.number().int().min(1).max(50) }).strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();

export const promoParams = z.object({ id: z.uuid(), promoId: z.uuid() });

export type CreatePromoBody = z.infer<typeof createPromoBody>;
export type UpdatePromoBody = z.infer<typeof updatePromoBody>;
export type ValidatePromoBody = z.infer<typeof validatePromoBody>;

// ───────────── helpers ─────────────

export const toPromoDto = (p: PromoCode) => ({
  id: p.id,
  code: p.code,
  eventId: p.eventId,
  discountType: p.discountType,
  discountValue: Number(p.discountValue),
  maxRedemptions: p.maxRedemptions,
  timesRedeemed: p.timesRedeemed,
  remaining: p.maxRedemptions === null ? null : Math.max(0, p.maxRedemptions - p.timesRedeemed),
  validFrom: p.validFrom?.toISOString() ?? null,
  validUntil: p.validUntil?.toISOString() ?? null,
  isActive: p.isActive,
  createdAt: p.createdAt.toISOString(),
});

/** Discount on a subtotal (minor units). Percent rounds down; never more than the subtotal. */
export function discountFor(
  p: Pick<PromoCode, "discountType" | "discountValue">,
  subtotal: bigint,
): bigint {
  const d = p.discountType === "percent" ? (subtotal * p.discountValue) / 100n : p.discountValue;
  return d > subtotal ? subtotal : d;
}

/**
 * Finds a code usable for this event (event-specific, or organizer-wide) and explains why not.
 * Same generic error for "doesn't exist" and "belongs to someone else": no code enumeration.
 */
export async function findUsable(eventId: string, rawCode: string, db: DbOrTx = prisma) {
  const event = await db.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) throw NotFound("Event");
  const promo = await db.promoCode.findUnique({
    where: { organizerId_code: { organizerId: event.organizerId, code: rawCode.toUpperCase() } },
  });
  const invalid = () =>
    Unprocessable("PROMO_CODE_INVALID", "This promo code isn't valid for this event");
  if (!promo || !promo.isActive || (promo.eventId && promo.eventId !== eventId)) throw invalid();
  const now = new Date();
  if (promo.validFrom && promo.validFrom > now) {
    throw Unprocessable(
      "PROMO_CODE_NOT_STARTED",
      `This code works from ${promo.validFrom.toISOString()}`,
    );
  }
  if (promo.validUntil && promo.validUntil <= now)
    throw Unprocessable("PROMO_CODE_EXPIRED", "This code has expired");
  if (promo.maxRedemptions !== null && promo.timesRedeemed >= promo.maxRedemptions) {
    throw Conflict("PROMO_CODE_EXHAUSTED", "This code has been used up");
  }
  return promo;
}

/**
 * Inside the booking transaction: claim one redemption atomically (same pattern as stock).
 * Returns false if the last redemption was taken in the meantime.
 */
export async function redeemInTx(tx: DbOrTx, promoId: string): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE promo_codes
    SET times_redeemed = times_redeemed + 1, updated_at = now()
    WHERE id = ${promoId}::uuid
      AND is_active
      AND now() >= coalesce(valid_from, '-infinity')
      AND now() < coalesce(valid_until, 'infinity')
      AND (max_redemptions IS NULL OR times_redeemed < max_redemptions)`;
  return n === 1;
}

// ───────────── organizer CRUD ─────────────

async function ownedEvent(auth: AuthContext, eventId: string) {
  const e = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!e || (e.organizerId !== auth.userId && auth.role !== "admin")) throw NotFound("Event");
  return e;
}

export async function list(auth: AuthContext, eventId: string) {
  const e = await ownedEvent(auth, eventId);
  const rows = await prisma.promoCode.findMany({
    where: { organizerId: e.organizerId, OR: [{ eventId }, { eventId: null }] },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPromoDto);
}

export async function create(
  auth: AuthContext,
  eventId: string,
  input: CreatePromoBody,
  ip: string | null,
) {
  const e = await ownedEvent(auth, eventId);
  try {
    const p = await prisma.promoCode.create({
      data: {
        ...input,
        discountValue: BigInt(input.discountValue),
        organizerId: e.organizerId,
        eventId,
      },
    });
    await writeAudit({
      actorId: auth.userId,
      action: "promo_code.created",
      entityType: "promo_code",
      entityId: p.id,
      ip,
      diff: { code: p.code, eventId },
    });
    return toPromoDto(p);
  } catch (err) {
    if (isUniqueViolation(err))
      throw Conflict("PROMO_CODE_EXISTS", "You already have a promo code with this name");
    throw err;
  }
}

async function ownedPromo(auth: AuthContext, eventId: string, promoId: string) {
  const e = await ownedEvent(auth, eventId);
  const p = await prisma.promoCode.findFirst({
    where: { id: promoId, organizerId: e.organizerId },
  });
  if (!p || (p.eventId && p.eventId !== eventId)) throw NotFound("Promo code");
  return p;
}

export async function update(
  auth: AuthContext,
  eventId: string,
  promoId: string,
  input: UpdatePromoBody,
  ip: string | null,
) {
  const p = await ownedPromo(auth, eventId, promoId);
  const type = input.discountType ?? p.discountType;
  const value = input.discountValue !== undefined ? BigInt(input.discountValue) : p.discountValue;
  if (type === "percent" && (value < 1n || value > 100n)) {
    throw Unprocessable("INVALID_DISCOUNT", "A percent discount must be 1-100");
  }
  if (input.maxRedemptions != null && input.maxRedemptions < p.timesRedeemed) {
    throw Conflict("BELOW_REDEEMED", `Already redeemed ${p.timesRedeemed} times`);
  }
  const updated = await prisma.promoCode.update({
    where: { id: promoId },
    data: { ...input, ...(input.discountValue !== undefined ? { discountValue: value } : {}) },
  });
  await writeAudit({
    actorId: auth.userId,
    action: "promo_code.updated",
    entityType: "promo_code",
    entityId: promoId,
    ip,
    diff: { fields: Object.keys(input) },
  });
  return toPromoDto(updated);
}

export async function remove(
  auth: AuthContext,
  eventId: string,
  promoId: string,
  ip: string | null,
) {
  const p = await ownedPromo(auth, eventId, promoId);
  if (
    p.timesRedeemed > 0 ||
    (await prisma.booking.count({ where: { promoCodeId: promoId } })) > 0
  ) {
    throw new AppError(
      409,
      "PROMO_CODE_USED",
      "This code was used in bookings; set isActive to false instead",
    );
  }
  await prisma.promoCode.delete({ where: { id: promoId } });
  await writeAudit({
    actorId: auth.userId,
    action: "promo_code.deleted",
    entityType: "promo_code",
    entityId: promoId,
    ip,
  });
}

// ───────────── buyer: check a code before booking ─────────────

export async function validate(input: ValidatePromoBody) {
  const promo = await findUsable(input.eventId, input.code);
  let preview: { subtotal: number; discountAmount: number; total: number } | null = null;
  if (input.items?.length) {
    const types = await prisma.ticketType.findMany({
      where: {
        id: { in: input.items.map((i) => i.ticketTypeId) },
        eventId: input.eventId,
        isActive: true,
      },
    });
    const subtotal = input.items.reduce((sum, i) => {
      const t = types.find((x) => x.id === i.ticketTypeId);
      return t ? sum + t.price * BigInt(i.quantity) : sum;
    }, 0n);
    const discount = discountFor(promo, subtotal);
    preview = {
      subtotal: Number(subtotal),
      discountAmount: Number(discount),
      total: Number(subtotal - discount),
    };
  }
  return {
    valid: true,
    code: promo.code,
    discountType: promo.discountType,
    discountValue: Number(promo.discountValue),
    ...(preview ? { preview } : {}),
  };
}
