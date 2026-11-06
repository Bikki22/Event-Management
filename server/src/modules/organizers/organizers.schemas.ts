import { z } from "zod";
import { SLUG_MAX, SLUG_PATTERN } from "../../lib/slug.js";

const orgName = z.string().trim().min(2, { error: "Organization name is too short" }).max(100);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(SLUG_MAX)
  .regex(SLUG_PATTERN, { error: "Use lowercase letters, numbers and single hyphens" });
const bio = z.string().trim().max(2000);
const website = z.url({ protocol: /^https?$/, error: "Enter a valid http(s) URL" }).max(300);
// until the uploads module exists, logos are external https URLs
const logoUrl = z.url({ protocol: /^https$/, error: "Logo must be an https URL" }).max(500);

// ───────────── /me/organizer-profile ─────────────

export const createProfileBody = z
  .object({
    orgName,
    slug: slug.optional(), // generated from orgName when omitted
    bio: bio.optional(),
    website: website.optional(),
    logoUrl: logoUrl.optional(),
    logoUploadId: z.uuid().optional(), // an organizer_logo upload (see upload.md)
  })
  .strict()
  .refine((v) => !(v.logoUrl && v.logoUploadId), {
    error: "Send logoUrl or logoUploadId, not both",
  });

// verificationStatus, reviewNote, userId... are not editable here
export const updateProfileBody = z
  .object({
    orgName: orgName.optional(),
    slug: slug.optional(),
    bio: bio.nullable().optional(),
    website: website.nullable().optional(),
    logoUrl: logoUrl.nullable().optional(),
    logoUploadId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => !(v.logoUrl && v.logoUploadId), {
    error: "Send logoUrl or logoUploadId, not both",
  })
  .refine((v) => Object.keys(v).length > 0, { error: "Provide at least one field to update" });

const accountName = z.string().trim().min(2).max(100);
// Nepali mobile numbers used as eSewa / Khalti wallet ids
const walletId = z
  .string()
  .trim()
  .regex(/^9[678]\d{8}$/, { error: "Enter the 10-digit mobile number of the wallet" });

export const payoutBody = z.discriminatedUnion("method", [
  z.object({ method: z.literal("esewa"), walletId, accountName }).strict(),
  z.object({ method: z.literal("khalti"), walletId, accountName }).strict(),
  z
    .object({
      method: z.literal("bank"),
      bankName: z.string().trim().min(2).max(100),
      branch: z.string().trim().min(2).max(100).optional(),
      accountName,
      accountNumber: z
        .string()
        .trim()
        .regex(/^[0-9A-Za-z-]{6,30}$/, { error: "Invalid account number" }),
    })
    .strict(),
]);

// ───────────── public + admin ─────────────

export const organizerSlugParams = z.object({
  slug: z.string().trim().toLowerCase().max(SLUG_MAX),
});
export const organizerUserIdParams = z.object({ userId: z.uuid() });

export const adminListOrganizersQuery = z
  .object({
    status: z.enum(["pending", "verified", "rejected"]).optional(),
    q: z.string().trim().min(1).max(100).optional(), // org name, slug or owner email
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(300).optional(),
  })
  .strict();

export const reviewBody = z
  .object({
    status: z.enum(["verified", "rejected"]),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => v.status !== "rejected" || v.note, {
    path: ["note"],
    error: "Explain why the profile is rejected",
  });

export type CreateProfileBody = z.infer<typeof createProfileBody>;
export type UpdateProfileBody = z.infer<typeof updateProfileBody>;
export type PayoutBody = z.infer<typeof payoutBody>;
export type AdminListOrganizersQuery = z.infer<typeof adminListOrganizersQuery>;
export type ReviewBody = z.infer<typeof reviewBody>;
