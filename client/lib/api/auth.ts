import { api } from "./client";
import type { AuthResponse, User } from "./types";

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const authApi = {
  register: (body: RegisterInput) =>
    api<AuthResponse>("/auth/register", { method: "POST", body, auth: false }),

  login: (body: LoginInput) => api<AuthResponse>("/auth/login", { method: "POST", body, auth: false }),

  logout: () => api<void>("/auth/logout", { method: "POST" }),

  me: () => api<{ user: User }>("/me"),

  verifyEmail: (token: string) =>
    api<{ user: User }>("/auth/verify-email", { method: "POST", body: { token }, auth: false }),

  resendVerification: () => api<void>("/auth/resend-verification", { method: "POST" }),

  forgotPassword: (email: string) =>
    api<void>("/auth/forgot-password", { method: "POST", body: { email }, auth: false }),

  resetPassword: (token: string, newPassword: string) =>
    api<void>("/auth/reset-password", { method: "POST", body: { token, newPassword }, auth: false }),
};
