import { api } from "./client";
import type { User } from "./types";

export interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface UpdateProfileInput {
  fullName?: string;
  /** null removes the phone number */
  phone?: string | null;
}

export const accountApi = {
  updateProfile: (body: UpdateProfileInput) => api<{ user: User }>("/me", { method: "PATCH", body }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api<void>("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),

  sessions: () => api<{ data: Session[] }>("/auth/sessions"),

  revokeSession: (id: string) => api<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
