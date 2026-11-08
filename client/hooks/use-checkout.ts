"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bookingsApi, paymentsApi, type CreateBookingInput, type ProviderName } from "@/lib/api/bookings";
import { ApiError } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useCheckoutStore } from "@/stores/checkout-store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useBooking(id: string | null) {
  return useQuery({
    queryKey: keys.bookings.detail(id ?? ""),
    queryFn: async () => (await bookingsApi.get(id!)).booking,
    enabled: !!id,
    staleTime: 0,
    // a refund is sent back by the worker a few seconds later: keep checking until it settles
    refetchInterval: (q) => {
      const status = q.state.data?.refund?.status;
      return status === "requested" || status === "processing" ? 4000 : false;
    },
  });
}

/**
 * POST /bookings with an Idempotency-Key tied to the body: double clicks and retries return the
 * same booking. Handles the two "come back later" answers of the idempotency layer.
 */
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateBookingInput) => {
      const { keyFor, forgetAttempt } = useCheckoutStore.getState();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return (await bookingsApi.create(body, keyFor("booking", body))).booking;
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          if (err.code === "REQUEST_IN_PROGRESS") {
            await sleep(1200); // the first request is still running: ask again with the same key
            continue;
          }
          if (err.code === "IDEMPOTENCY_KEY_REUSED") {
            forgetAttempt("booking"); // a stale key from an older body: start fresh
            continue;
          }
          forgetAttempt("booking"); // a real error: let the next try be a new request
          throw err;
        }
      }
      throw new ApiError(409, "REQUEST_IN_PROGRESS", "Still processing your booking. Please try again.");
    },
    onSuccess: (booking) => {
      qc.setQueryData(keys.bookings.detail(booking.id), booking);
      qc.invalidateQueries({ queryKey: keys.events.availability(booking.event.id) });
    },
  });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await bookingsApi.cancel(id)).booking,
    onSuccess: (booking) => {
      qc.setQueryData(keys.bookings.detail(booking.id), booking);
      qc.invalidateQueries({ queryKey: keys.events.availability(booking.event.id) });
    },
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ["payment-providers"],
    queryFn: async () => (await paymentsApi.providers()).data,
    staleTime: 5 * 60_000,
  });
}

export function useStartPayment() {
  return useMutation({
    mutationFn: async ({ bookingId, provider }: { bookingId: string; provider: ProviderName }) => {
      const key = useCheckoutStore.getState().keyFor("payment", { bookingId, provider });
      return paymentsApi.initiate(bookingId, provider, key);
    },
    onError: () => useCheckoutStore.getState().forgetAttempt("payment"),
  });
}
