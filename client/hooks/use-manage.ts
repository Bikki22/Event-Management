"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import type { EventStatus } from "@/lib/api/events";
import { keys } from "@/lib/api/keys";
import {
  isManageEvent,
  manageApi,
  type Attendee,
  type AttendeeStatus,
  type EventInput,
  type ManageEvent,
  type MyEventRow,
  type PromoInput,
  type StaffRole,
  type TicketTypeInput,
  type VenueInput,
} from "@/lib/api/manage";
import { cursorPagination, flattenPages } from "@/lib/api/pagination";

/** Prefix of every GET /me/events list, whatever the filter. */
const MY_EVENTS = [...keys.me.all, "events"];

// ───────────── events ─────────────

export function useMyEvents(status?: EventStatus) {
  const query = useInfiniteQuery({
    queryKey: keys.me.events({ status }),
    queryFn: ({ pageParam }) => manageApi.myEvents({ status, cursor: pageParam, limit: 20 }),
    ...cursorPagination<MyEventRow>(),
    placeholderData: keepPreviousData,
  });
  return { ...query, events: flattenPages(query.data?.pages) };
}

/** The owner's view of one event. Resolves to null when it's not yours (the API hides it). */
export function useManageEvent(id: string) {
  return useQuery({
    queryKey: keys.manage.event(id),
    queryFn: async (): Promise<ManageEvent | null> => {
      try {
        const { event } = await manageApi.event(id);
        return isManageEvent(event) ? event : null;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
        throw err;
      }
    },
  });
}

/** After any event write: put the fresh event in the cache and refresh lists and public pages. */
function useEventWritten() {
  const qc = useQueryClient();
  return (event: ManageEvent) => {
    qc.setQueryData(keys.manage.event(event.id), event);
    void qc.invalidateQueries({ queryKey: MY_EVENTS });
    void qc.invalidateQueries({ queryKey: keys.events.all });
  };
}

export function useCreateEvent() {
  const written = useEventWritten();
  return useMutation({
    mutationFn: (body: EventInput) => manageApi.create(body),
    onSuccess: ({ event }) => written(event),
  });
}

/** PATCH with If-Match: pass the version the form was loaded from, not the latest one. */
export function useUpdateEvent(id: string) {
  const written = useEventWritten();
  return useMutation({
    mutationFn: ({ version, body }: { version: number; body: Partial<EventInput> }) => manageApi.update(id, version, body),
    onSuccess: ({ event }) => written(event),
  });
}

export function usePublishEvent(id: string) {
  const written = useEventWritten();
  return useMutation({ mutationFn: () => manageApi.publish(id), onSuccess: ({ event }) => written(event) });
}

export function useCancelEvent(id: string) {
  const written = useEventWritten();
  return useMutation({
    mutationFn: (reason: string) => manageApi.cancel(id, reason),
    onSuccess: ({ event }) => written(event),
  });
}

export function useDeleteEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => manageApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MY_EVENTS });
    },
  });
}

// ───────────── ticket types ─────────────

/** Ticket types live inside the event, so every write just refetches it. */
function useRefetchEvent(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.manage.event(id), exact: true });
    void qc.invalidateQueries({ queryKey: MY_EVENTS });
    void qc.invalidateQueries({ queryKey: keys.events.all });
  };
}

export function useSaveTicketType(eventId: string) {
  const refetch = useRefetchEvent(eventId);
  return useMutation({
    mutationFn: (v: { ttId?: string; version?: number; body: TicketTypeInput }) =>
      v.ttId ? manageApi.updateTicketType(eventId, v.ttId, v.version ?? 0, v.body) : manageApi.createTicketType(eventId, v.body),
    onSuccess: refetch,
  });
}

export function useToggleTicketType(eventId: string) {
  const refetch = useRefetchEvent(eventId);
  return useMutation({
    mutationFn: (v: { ttId: string; version: number; isActive: boolean }) =>
      manageApi.updateTicketType(eventId, v.ttId, v.version, { isActive: v.isActive }),
    onSuccess: refetch,
    onError: refetch, // stale version → show the current state
  });
}

export function useDeleteTicketType(eventId: string) {
  const refetch = useRefetchEvent(eventId);
  return useMutation({ mutationFn: (ttId: string) => manageApi.deleteTicketType(eventId, ttId), onSuccess: refetch });
}

// ───────────── venues ─────────────

export function useVenues(q: string) {
  return useQuery({
    queryKey: keys.manage.venues({ q }),
    queryFn: async () => (await manageApi.venues({ q: q || undefined })).data,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useCreateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VenueInput) => manageApi.createVenue(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...keys.manage.all, "venues"] }),
  });
}

// ───────────── promo codes ─────────────

export function usePromoCodes(eventId: string) {
  return useQuery({
    queryKey: keys.manage.promoCodes(eventId),
    queryFn: async () => (await manageApi.promoCodes(eventId)).data,
  });
}

export function useSavePromo(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { promoId?: string; body: PromoInput }) => {
      if (!v.promoId) return manageApi.createPromo(eventId, v.body);
      const { code, ...rest } = v.body; // the code text can't change
      void code;
      return manageApi.updatePromo(eventId, v.promoId, rest);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.manage.promoCodes(eventId) }),
  });
}

export function useTogglePromo(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { promoId: string; isActive: boolean }) => manageApi.updatePromo(eventId, v.promoId, { isActive: v.isActive }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.manage.promoCodes(eventId) }),
  });
}

export function useDeletePromo(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (promoId: string) => manageApi.deletePromo(eventId, promoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.manage.promoCodes(eventId) }),
  });
}

// ───────────── attendees ─────────────

export function useAttendees(eventId: string, filter: { q?: string; status?: AttendeeStatus }) {
  const query = useInfiniteQuery({
    queryKey: keys.manage.attendees(eventId, filter),
    queryFn: ({ pageParam }) => manageApi.attendees(eventId, { ...filter, cursor: pageParam, limit: 50 }),
    ...cursorPagination<Attendee>(),
    placeholderData: keepPreviousData,
  });
  return { ...query, attendees: flattenPages(query.data?.pages) };
}

export function useCheckInStats(eventId: string) {
  return useQuery({
    queryKey: keys.manage.checkIns(eventId),
    queryFn: () => manageApi.checkInStats(eventId),
    refetchInterval: 30_000,
  });
}

/** Starts a CSV export and polls until it's ready (the worker builds the file). */
export function useAttendeeExport(eventId: string) {
  const [exportId, setExportId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => manageApi.requestExport(eventId),
    onSuccess: ({ export: e }) => setExportId(e.id),
  });
  const job = useQuery({
    queryKey: [...keys.manage.all, "export", exportId],
    queryFn: async () => (await manageApi.getExport(exportId!)).export,
    enabled: !!exportId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "ready" || s === "failed" ? false : 1500;
    },
    gcTime: 0,
  });
  // forget a finished job after the download link would have expired (10 min)
  useEffect(() => {
    if (job.data?.status !== "ready") return;
    const t = window.setTimeout(() => setExportId(null), 9 * 60_000);
    return () => window.clearTimeout(t);
  }, [job.data?.status]);

  return { start, job: exportId ? job.data : undefined, reset: () => setExportId(null) };
}

// ───────────── staff ─────────────

export function useStaff(eventId: string) {
  return useQuery({ queryKey: keys.manage.staff(eventId), queryFn: async () => (await manageApi.staff(eventId)).data });
}

export function useAddStaff(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; role: StaffRole }) => manageApi.addStaff(eventId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.manage.staff(eventId) }),
  });
}

export function useRemoveStaff(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => manageApi.removeStaff(eventId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.manage.staff(eventId) }),
  });
}

// ───────────── misc ─────────────

/** `value`, updated only after it stops changing for `ms`. For search boxes. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
