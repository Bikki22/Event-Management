import { z } from "zod";
import { phone } from "../users/users.schemas.js";

export const MAX_TICKETS_PER_BOOKING = 50;

export const createBookingBody = z
  .object({
    eventId: z.uuid(),
    items: z
      .array(
        z.object({ ticketTypeId: z.uuid(), quantity: z.number().int().min(1).max(50) }).strict(),
      )
      .min(1)
      .max(10)
      .refine((items) => new Set(items.map((i) => i.ticketTypeId)).size === items.length, {
        error: "Each ticket type may appear only once",
      })
      .refine((items) => items.reduce((n, i) => n + i.quantity, 0) <= MAX_TICKETS_PER_BOOKING, {
        error: `At most ${MAX_TICKETS_PER_BOOKING} tickets per booking`,
      }),
    contactPhone: phone.optional(), // defaults to the account phone
  })
  .strict();

export const bookingIdParams = z.object({ id: z.uuid() });

export const myBookingsQuery = z
  .object({
    status: z
      .enum(["pending", "confirmed", "cancelled", "expired", "refunded", "partially_refunded"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(300).optional(),
  })
  .strict();

export type CreateBookingBody = z.infer<typeof createBookingBody>;
export type MyBookingsQuery = z.infer<typeof myBookingsQuery>;
