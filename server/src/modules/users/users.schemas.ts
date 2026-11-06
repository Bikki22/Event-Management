import { z } from "zod";

// Shared field rules (also used by auth.schemas.ts for register).
export const fullName = z.string().trim().min(1, { error: "Name is required" }).max(120);
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, { error: "Invalid phone number" });

// ───────────── /me ─────────────

// .strict(): email, role, status, emailVerified... can't be changed through this endpoint
export const updateMeBody = z
  .object({
    fullName: fullName.optional(),
    phone: phone.nullable().optional(), // null clears it
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Provide at least one field to update" });

export type UpdateMeBody = z.infer<typeof updateMeBody>;

// ───────────── /admin/users ─────────────

export const userIdParams = z.object({ id: z.uuid() });

export const adminListUsersQuery = z
  .object({
    q: z.string().trim().min(1).max(100).optional(), // matches email or name
    role: z.enum(["attendee", "organizer", "admin"]).optional(),
    status: z.enum(["active", "suspended", "deleted"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export const adminUpdateUserBody = z
  .object({
    role: z.enum(["attendee", "organizer", "admin"]).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    error: "Provide role and/or status",
  });

export type AdminListUsersQuery = z.infer<typeof adminListUsersQuery>;
export type AdminUpdateUserBody = z.infer<typeof adminUpdateUserBody>;
