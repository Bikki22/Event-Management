import { z } from "zod";

// Mirrors server/src/modules/organizers/organizers.schemas.ts.

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v), { error: "Enter a full link, e.g. https://example.com" });

export const organizerSchema = z.object({
  orgName: z.string().trim().min(2, { error: "Use at least 2 characters" }).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || (v.length >= 3 && v.length <= 60), { error: "Use 3–60 characters" })
    .refine((v) => v === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), {
      error: "Lowercase letters, numbers and single hyphens only",
    }),
  bio: z.string().trim().max(2000, { error: "Keep it under 2000 characters" }),
  website: optionalUrl,
});
export type OrganizerValues = z.infer<typeof organizerSchema>;

const accountName = z.string().trim().min(2, { error: "Enter the account holder's name" }).max(100);
const walletId = z
  .string()
  .trim()
  .regex(/^9[678]\d{8}$/, { error: "Enter the 10-digit mobile number of the wallet (starts with 96, 97 or 98)" });

export const payoutSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("esewa"), walletId, accountName }),
  z.object({ method: z.literal("khalti"), walletId, accountName }),
  z.object({
    method: z.literal("bank"),
    bankName: z.string().trim().min(2, { error: "Enter the bank name" }).max(100),
    branch: z.string().trim().max(100),
    accountName,
    accountNumber: z
      .string()
      .trim()
      .regex(/^[0-9A-Za-z-]{6,30}$/, { error: "6–30 letters, digits or hyphens" }),
  }),
]);
export type PayoutValues = z.infer<typeof payoutSchema>;
