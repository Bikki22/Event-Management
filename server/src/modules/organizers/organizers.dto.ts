import type { OrganizerProfile, User } from "../../generated/prisma/client.js";
import { decryptJson } from "../../lib/encryption.js";
import { logger } from "../../lib/logger.js";
import type { PayoutBody } from "./organizers.schemas.js";

export const payoutAad = (userId: string) => `organizer_profiles.payout_details:${userId}`;

/** Payout details are never returned in full: enough to recognise the account, not to use it. */
export type MaskedPayout =
  | { method: "esewa" | "khalti"; accountName: string; walletId: string }
  | {
      method: "bank";
      bankName: string;
      branch: string | null;
      accountName: string;
      accountNumber: string;
    };

const maskTail = (s: string, keep = 4) =>
  s.length <= keep ? "*".repeat(s.length) : "*".repeat(s.length - keep) + s.slice(-keep);

export function maskPayout(p: PayoutBody): MaskedPayout {
  if (p.method === "bank") {
    return {
      method: "bank",
      bankName: p.bankName,
      branch: p.branch ?? null,
      accountName: p.accountName,
      accountNumber: maskTail(p.accountNumber),
    };
  }
  return {
    method: p.method,
    accountName: p.accountName,
    walletId: `${p.walletId.slice(0, 2)}${"*".repeat(6)}${p.walletId.slice(-2)}`,
  };
}

function readPayout(p: OrganizerProfile): MaskedPayout | null {
  if (!p.payoutDetails) return null;
  try {
    return maskPayout(decryptJson<PayoutBody>(p.payoutDetails, payoutAad(p.userId)));
  } catch (err) {
    // wrong/missing key: don't fail the whole profile, but make it visible in logs
    logger.error({ err, userId: p.userId }, "payout details could not be decrypted");
    return null;
  }
}

/** The owner's view of their profile. */
export interface OrganizerProfileDto {
  userId: string;
  orgName: string;
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  website: string | null;
  verificationStatus: OrganizerProfile["verificationStatus"];
  reviewNote: string | null;
  reviewedAt: string | null;
  payout: MaskedPayout | null;
  createdAt: string;
  updatedAt: string;
}

export const toProfileDto = (p: OrganizerProfile): OrganizerProfileDto => ({
  userId: p.userId,
  orgName: p.orgName,
  slug: p.slug,
  bio: p.bio,
  logoUrl: p.logoUrl,
  website: p.website,
  verificationStatus: p.verificationStatus,
  reviewNote: p.reviewNote,
  reviewedAt: p.reviewedAt?.toISOString() ?? null,
  payout: readPayout(p),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/** Public page: no review notes, no payout info. */
export interface PublicOrganizerDto {
  orgName: string;
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  website: string | null;
  verified: boolean;
  memberSince: string;
}

export const toPublicDto = (p: OrganizerProfile): PublicOrganizerDto => ({
  orgName: p.orgName,
  slug: p.slug,
  bio: p.bio,
  logoUrl: p.logoUrl,
  website: p.website,
  verified: p.verificationStatus === "verified",
  memberSince: p.createdAt.toISOString(),
});

/** Admin view: profile + owner. */
export type AdminOrganizerDto = OrganizerProfileDto & {
  owner: {
    id: string;
    email: string;
    fullName: string;
    status: User["status"];
    emailVerified: boolean;
  };
};

export const toAdminDto = (p: OrganizerProfile & { user: User }): AdminOrganizerDto => ({
  ...toProfileDto(p),
  owner: {
    id: p.user.id,
    email: p.user.email,
    fullName: p.user.fullName,
    status: p.user.status,
    emailVerified: p.user.emailVerifiedAt !== null,
  },
});
