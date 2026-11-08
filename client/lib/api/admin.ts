import { api, qs } from "./client";
import type { Category, CategoryNode } from "./catalog";
import type { OrganizerProfile, VerificationStatus } from "./organizer";
import type { Page } from "./pagination";
import type { Role, User } from "./types";

// Admin panel (server/src/modules/admin, users, organizers, categories; admin.md).

export interface AdminStats {
  users: { total: number; newLast7Days: number };
  organizers: { pendingVerification: number };
  events: { live: number };
  bookings: { confirmed: number; confirmedLast24h: number };
  revenue: { currency: string; amount: number }[];
  refunds: { open: number; awaitingManualAction: number };
  payments: { failedLast24h: number };
}

export type UserStatus = "active" | "suspended" | "deleted";

export interface AdminUser extends User {
  status: UserStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  updatedAt: string;
  activeSessions?: number;
}

export interface AdminOrganizer extends OrganizerProfile {
  owner: { id: string; email: string; fullName: string; status: UserStatus; emailVerified: boolean };
}

export type PaymentStatus = "initiated" | "pending" | "succeeded" | "failed" | "cancelled" | "refunded";
export type Provider = "esewa" | "khalti" | "stripe" | "free" | "mock";

export interface AdminPayment {
  id: string;
  bookingId: string;
  provider: Provider;
  amount: number;
  currency: string;
  status: PaymentStatus;
  failureReason: string | null;
  initiatedAt: string;
  completedAt: string | null;
  providerTxnId: string | null;
  providerRef: string | null;
}

export type RefundStatus = "requested" | "processing" | "succeeded" | "failed";

export interface AdminRefund {
  id: string;
  bookingId: string;
  amount: number;
  status: RefundStatus;
  /** the gateway has no refund API (eSewa): someone pays it back by hand */
  manual: boolean;
  reason: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  provider: Provider | null;
  bookingCode: string;
  currency: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string; name: string | null; email: string | null } | null;
  diff: unknown;
  ip: string | null;
  createdAt: string;
}

export interface CategoryInput {
  name: string;
  slug?: string;
  parentId?: string | null;
  sortOrder?: number;
}

type Cursor = { cursor?: string; limit?: number };
const enc = encodeURIComponent;

export const adminApi = {
  stats: () => api<AdminStats>("/admin/stats"),

  users: (p: { q?: string; role?: Role; status?: UserStatus } & Cursor) => api<Page<AdminUser>>(`/admin/users${qs(p)}`),
  user: (id: string) => api<{ user: AdminUser }>(`/admin/users/${enc(id)}`),
  updateUser: (id: string, body: { role?: Role; status?: "active" | "suspended" }) =>
    api<{ user: AdminUser }>(`/admin/users/${enc(id)}`, { method: "PATCH", body }),

  organizers: (p: { q?: string; status?: VerificationStatus } & Cursor) =>
    api<Page<AdminOrganizer>>(`/admin/organizers${qs(p)}`),
  review: (userId: string, body: { status: "verified" | "rejected"; note?: string }) =>
    api<{ organizer: AdminOrganizer }>(`/admin/organizers/${enc(userId)}/verification`, { method: "PATCH", body }),

  /** the public tree, revalidated (it is sent with max-age=300) so edits show up at once */
  categoryTree: () => api<{ data: CategoryNode[] }>("/categories", { auth: false, cache: "no-cache" }),
  createCategory: (body: CategoryInput) => api<{ category: Category }>("/admin/categories", { method: "POST", body }),
  updateCategory: (id: string, body: Partial<CategoryInput>) =>
    api<{ category: Category }>(`/admin/categories/${enc(id)}`, { method: "PATCH", body }),
  deleteCategory: (id: string) => api<void>(`/admin/categories/${enc(id)}`, { method: "DELETE" }),

  payments: (p: { status?: PaymentStatus; provider?: Provider; bookingId?: string } & Cursor) =>
    api<Page<AdminPayment>>(`/admin/payments${qs(p)}`),
  refunds: (p: { status?: RefundStatus; manual?: boolean } & Cursor) => api<Page<AdminRefund>>(`/admin/refunds${qs(p)}`),
  completeRefund: (id: string, providerRefundId?: string) =>
    api<{ refund: AdminRefund }>(`/admin/refunds/${enc(id)}/complete`, {
      method: "POST",
      body: providerRefundId ? { providerRefundId } : {},
    }),
  retryRefund: (id: string) => api<{ refund: AdminRefund }>(`/admin/refunds/${enc(id)}/retry`, { method: "POST" }),

  auditLogs: (p: { action?: string; entityType?: string; entityId?: string; actorId?: string; from?: string; to?: string } & Cursor) =>
    api<Page<AuditEntry>>(`/admin/audit-logs${qs(p)}`),
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  esewa: "eSewa",
  khalti: "Khalti",
  stripe: "Stripe",
  free: "Free",
  mock: "Test gateway",
};
