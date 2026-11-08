"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { catalogApi } from "@/lib/api/catalog";
import { eventsApi, type EventCard, type EventFilters } from "@/lib/api/events";
import { keys } from "@/lib/api/keys";
import { cursorPagination, flattenPages } from "@/lib/api/pagination";
import { rangeFor, type WhenPreset } from "@/lib/dates";

/** List filters plus a relative date preset ("this weekend"), resolved to from/to at fetch time. */
export type ListFilters = EventFilters & { when?: WhenPreset };

// The preset stays in the query key, and "now" is read only inside the fetch. That keeps keys
// stable and keeps the clock out of render (prerendering forbids `new Date()` in render).
function resolve({ when, ...rest }: ListFilters): EventFilters {
  return when ? { ...rest, ...rangeFor(when) } : rest;
}

/** Infinite list for browse/category pages. Keeps the old results visible while filters change. */
export function useEventList(filters: ListFilters) {
  const query = useInfiniteQuery({
    queryKey: keys.events.list({ ...filters }),
    queryFn: ({ pageParam }) => eventsApi.list({ ...resolve(filters), cursor: pageParam }),
    ...cursorPagination<EventCard>(),
    placeholderData: keepPreviousData,
    staleTime: 30_000, // matches the API's Cache-Control max-age
  });
  return { ...query, events: flattenPages(query.data?.pages) };
}

/** First page only (home page rows). */
export function useEventRow(filters: ListFilters) {
  return useQuery({
    queryKey: keys.events.list({ ...filters, row: true }),
    queryFn: async () => (await eventsApi.list(resolve(filters))).data,
    staleTime: 30_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories.all,
    queryFn: async () => (await catalogApi.categories()).data,
    staleTime: 60 * 60_000, // the tree rarely changes
  });
}

/** Live seats left; polled while the event page is open. */
export function useAvailability(eventId: string, enabled = true) {
  return useQuery({
    queryKey: keys.events.availability(eventId),
    queryFn: () => eventsApi.availability(eventId),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}
