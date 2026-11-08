import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface CheckoutLine {
  ticketTypeId: string;
  name: string;
  unitPrice: number; // paisa
  quantity: number;
}

/** An Idempotency-Key tied to the exact request body it was used with. */
interface Attempt {
  key: string;
  signature: string;
}

interface CheckoutState {
  eventId: string | null;
  eventSlug: string | null;
  eventTitle: string | null;
  currency: string;
  lines: CheckoutLine[];
  /** pending booking created from this selection (survives a refresh mid-checkout) */
  bookingId: string | null;
  bookingAttempt: Attempt | null;
  paymentAttempt: Attempt | null;

  /** Replaces the selection (one event per checkout) and forgets any earlier booking. */
  start: (s: { eventId: string; eventSlug: string; eventTitle: string; currency: string; lines: CheckoutLine[] }) => void;
  setBookingId: (id: string | null) => void;
  /**
   * The key to send for a request body. Same body as last time → same key (a retry or double
   * click replays the original response); a different body → a fresh key (reusing one with a new
   * body is rejected as IDEMPOTENCY_KEY_REUSED).
   */
  keyFor: (kind: "booking" | "payment", body: unknown) => string;
  forgetAttempt: (kind: "booking" | "payment") => void;
  reset: () => void;
}

const empty = {
  eventId: null,
  eventSlug: null,
  eventTitle: null,
  currency: "NPR",
  lines: [] as CheckoutLine[],
  bookingId: null,
  bookingAttempt: null,
  paymentAttempt: null,
};

/**
 * The tickets picked on an event page, plus the checkout's in-flight booking.
 * Kept in sessionStorage (per tab) so refreshing the checkout or coming back from a gateway works.
 */
export const useCheckoutStore = create<CheckoutState>()(
  persist(
    (set, get) => ({
      ...empty,
      start: (s) => set({ ...empty, ...s, lines: s.lines.filter((l) => l.quantity > 0) }),
      setBookingId: (bookingId) => set({ bookingId, paymentAttempt: null }),
      keyFor: (kind, body) => {
        const signature = JSON.stringify(body);
        const field = kind === "booking" ? "bookingAttempt" : "paymentAttempt";
        const current = get()[field];
        if (current?.signature === signature) return current.key;
        const key = crypto.randomUUID();
        set({ [field]: { key, signature } } as Partial<CheckoutState>);
        return key;
      },
      forgetAttempt: (kind) => set(kind === "booking" ? { bookingAttempt: null } : { paymentAttempt: null }),
      reset: () => set(empty),
    }),
    {
      name: "book-event-checkout",
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true, // rehydrated on the client by the pages that read it (avoids SSR mismatch)
    },
  ),
);

/** Rehydrate once on the client; resolves when the stored checkout is loaded. */
let hydrating: Promise<void> | null = null;
export function hydrateCheckout(): Promise<void> {
  hydrating ??= Promise.resolve(useCheckoutStore.persist.rehydrate());
  return hydrating;
}
