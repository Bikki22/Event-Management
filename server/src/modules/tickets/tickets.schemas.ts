import { z } from "zod";
import { fullName } from "../users/users.schemas.js";

export const ticketIdParams = z.object({ id: z.uuid() });

export const myTicketsQuery = z
  .object({
    upcoming: z.stringbool().optional(),
    status: z.enum(["valid", "checked_in", "cancelled", "refunded"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(300).optional(),
  })
  .strict();

export const holderBody = z
  .object({
    holderName: fullName,
    holderEmail: z.email().trim().toLowerCase().max(254).nullable().optional(),
  })
  .strict();

// ───────────── check-in / staff ─────────────

export const eventParams = z.object({ id: z.uuid() });

export const checkInBody = z
  .object({
    // scanners send exactly what the QR contains; be forgiving about case and spaces
    ticketCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^TKT-[0-9A-Z]{16}$/, { error: "Not a ticket code" }),
  })
  .strict();

export const addStaffBody = z
  .object({
    email: z.email().trim().toLowerCase().max(254),
    role: z.enum(["scanner", "manager"]).default("scanner"),
  })
  .strict();

export const staffParams = z.object({ id: z.uuid(), userId: z.uuid() });

export type MyTicketsQuery = z.infer<typeof myTicketsQuery>;
export type HolderBody = z.infer<typeof holderBody>;
export type AddStaffBody = z.infer<typeof addStaffBody>;
