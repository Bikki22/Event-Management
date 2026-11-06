import { create } from "zustand";
import type { User } from "@/lib/api/types";

/**
 * booting:       app just loaded, trying to restore the session from the refresh cookie
 * authenticated: we hold an access token and the current user
 * guest:         no valid session
 */
export type AuthStatus = "booting" | "authenticated" | "guest";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Kept in memory only (never localStorage), per auth.md §3.1. */
  accessToken: string | null;
  /** Epoch ms when the access token expires. */
  expiresAt: number | null;

  setSession: (s: { accessToken: string; expiresIn: number; user?: User }) => void;
  setUser: (user: User) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: "booting",
  user: null,
  accessToken: null,
  expiresAt: null,

  setSession: ({ accessToken, expiresIn, user }) =>
    set((s) => {
      const nextUser = user ?? s.user;
      return {
        accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
        user: nextUser,
        // without a user yet (refresh during boot) we stay in "booting" until /me resolves
        status: nextUser ? "authenticated" : s.status,
      };
    }),

  setUser: (user) => set({ user, status: "authenticated" }),

  clear: () => set({ status: "guest", user: null, accessToken: null, expiresAt: null }),
}));
