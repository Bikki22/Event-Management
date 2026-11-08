import { api } from "./client";

// The signed-in user's organizer profile (server/src/modules/organizers, organizers.md).

export type VerificationStatus = "pending" | "verified" | "rejected";

export type MaskedPayout =
  | { method: "esewa" | "khalti"; accountName: string; walletId: string }
  | { method: "bank"; bankName: string; branch: string | null; accountName: string; accountNumber: string };

export interface OrganizerProfile {
  userId: string;
  orgName: string;
  slug: string;
  bio: string | null;
  logoUrl: string | null;
  website: string | null;
  verificationStatus: VerificationStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  payout: MaskedPayout | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileInput {
  orgName: string;
  slug?: string;
  bio?: string | null;
  website?: string | null;
  logoUploadId?: string;
  logoUrl?: string | null;
}

export type PayoutInput =
  | { method: "esewa" | "khalti"; walletId: string; accountName: string }
  | { method: "bank"; bankName: string; branch?: string; accountName: string; accountNumber: string };

export const organizerApi = {
  /** 404 when the user hasn't applied yet. */
  mine: () => api<{ profile: OrganizerProfile }>("/me/organizer-profile"),
  apply: (body: ProfileInput) => api<{ profile: OrganizerProfile }>("/me/organizer-profile", { method: "POST", body }),
  update: (body: Partial<ProfileInput>) => api<{ profile: OrganizerProfile }>("/me/organizer-profile", { method: "PATCH", body }),
  setPayout: (body: PayoutInput) => api<{ profile: OrganizerProfile }>("/me/organizer-profile/payout", { method: "PUT", body }),
  removePayout: () => api<void>("/me/organizer-profile/payout", { method: "DELETE" }),
};

export const VERIFICATION: Record<VerificationStatus, { label: string; tone: "warning" | "success" | "danger" }> = {
  pending: { label: "In review", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Changes needed", tone: "danger" },
};

/** Mirrors the server: lowercase letters, numbers and single hyphens. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}
