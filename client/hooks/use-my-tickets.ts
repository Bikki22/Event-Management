"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bookingsApi, type Booking, type BookingStatus } from "@/lib/api/bookings";
import { ApiError } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { cursorPagination, flattenPages } from "@/lib/api/pagination";
import { ticketsApi, type TicketListFilter, type TicketSummary } from "@/lib/api/tickets";

export function useMyTickets(filter: TicketListFilter) {
  const query = useInfiniteQuery({
    queryKey: keys.me.tickets({ ...filter }),
    queryFn: ({ pageParam }) => ticketsApi.mine({ ...filter, cursor: pageParam }),
    ...cursorPagination<TicketSummary>(),
    placeholderData: keepPreviousData,
  });
  return { ...query, tickets: flattenPages(query.data?.pages) };
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: keys.tickets.detail(id),
    queryFn: async () => (await ticketsApi.get(id)).ticket,
  });
}

export function useSetHolder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { holderName: string; holderEmail?: string | null }) => ticketsApi.setHolder(id, body),
    onSuccess: ({ ticket }) => {
      qc.setQueryData(keys.tickets.detail(id), ticket);
      qc.invalidateQueries({ queryKey: keys.me.tickets() });
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Downloads the ticket PDF. The worker renders it right after booking (and again after a holder
 * change), so the first request may answer PDF_NOT_READY: wait and ask again a few times.
 */
export function useDownloadPdf() {
  return useMutation({
    mutationFn: async (id: string) => {
      for (let attempt = 0; ; attempt++) {
        try {
          const { url } = await ticketsApi.pdfLink(id);
          // signed, 5-minute link on the storage host; the server sets the file name
          const a = document.createElement("a");
          a.href = url;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
          return;
        } catch (err) {
          if (err instanceof ApiError && err.code === "PDF_NOT_READY" && attempt < 4) {
            await sleep(2500);
            continue;
          }
          throw err;
        }
      }
    },
  });
}

export function useMyBookings(status?: BookingStatus) {
  const query = useInfiniteQuery({
    queryKey: keys.me.bookings({ status }),
    queryFn: ({ pageParam }) => bookingsApi.mine({ status, cursor: pageParam }),
    ...cursorPagination<Booking>(),
    placeholderData: keepPreviousData,
  });
  return { ...query, bookings: flattenPages(query.data?.pages) };
}

export function useRequestRefund(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reason, key }: { reason: string; key: string }) => bookingsApi.requestRefund(bookingId, reason, key),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.bookings.detail(bookingId) });
      qc.invalidateQueries({ queryKey: keys.me.bookings() });
      qc.invalidateQueries({ queryKey: keys.me.tickets() });
    },
  });
}
