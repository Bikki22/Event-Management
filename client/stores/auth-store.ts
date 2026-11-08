import { create } from "zustand";
import type { User } from "@/lib/api/types";

/**
 * booting:       app just loaded, trying to restore the session from the refresh cookie
 * authenticated: we hold an access token and the current user
 * guest:         no valid session
 */
export type AuthStatus = "booting" | "authenticated" | "guest";

/** Why an active session ended; "expired" covers revoked sessions and failed refreshes. */
export type EndReason = "logout" | "expired";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Kept in memory only (never localStorage), per auth.md §3.1. */
  accessToken: string | null;
  /** Epoch ms when the access token expires. */
  expiresAt: number | null;
  /** Set when a signed-in session ends, so the UI can explain it. */
  endedReason: EndReason | null;

  setSession: (s: { accessToken: string; expiresIn: number; user?: User }) => void;
  setUser: (user: User) => void;
  clear: (reason?: EndReason) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: "booting",
  user: null,
  accessToken: null,
  expiresAt: null,
  endedReason: null,

  setSession: ({ accessToken, expiresIn, user }) =>
    set((s) => {
      const nextUser = user ?? s.user;
      return {
        accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
        user: nextUser,
        endedReason: null,
        // without a user yet (refresh during boot) we stay in "booting" until /me resolves
        status: nextUser ? "authenticated" : s.status,
      };
    }),

  setUser: (user) => set({ user, status: "authenticated", endedReason: null }),

  clear: (reason) =>
    set((s) => ({
      status: "guest",
      user: null,
      accessToken: null,
      expiresAt: null,
      // only a session that was actually active can "end"; failing to restore on boot is just a guest
      endedReason: s.status === "authenticated" ? (reason ?? "logout") : null,
    })),
}));
