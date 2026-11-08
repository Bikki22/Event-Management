import { create } from "zustand";

/**
 * Remembers the last page the user was on outside "self-contained" areas (account, auth),
 * so their back button can return there instead of relying on browser history
 * (which may contain tab switches, login redirects or another site).
 */
interface ReturnToState {
  returnTo: string | null;
  setReturnTo: (path: string) => void;
}

export const useReturnTo = create<ReturnToState>()((set) => ({
  returnTo: null,
  setReturnTo: (returnTo) => set({ returnTo }),
}));

/** Paths that don't count as a place to go "back" to. */
export const SELF_CONTAINED = [/^\/account(\/|$)/, /^\/(login|register|forgot-password|reset-password|verify-email)(\/|$)/];
