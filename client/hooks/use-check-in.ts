"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { checkinApi, toOutcome, type ScanOutcome, type StaffEvent } from "@/lib/api/checkin";
import { keys } from "@/lib/api/keys";
import { manageApi } from "@/lib/api/manage";

/** One entry of the door's event list: events I'm staff on, plus my own as organizer. */
export interface DoorEvent extends Omit<StaffEvent, "role"> {
  role: StaffEvent["role"] | "organizer";
}

/**
 * Staff events come from /me/staff-events. Organizers aren't on their own staff list,
 * so their published events are added from /me/events.
 */
export function useDoorEvents() {
  const { user } = useAuth();
  const organizer = user?.role === "organizer" || user?.role === "admin";
  return useQuery({
    queryKey: [...keys.me.all, "door-events", organizer],
    queryFn: async (): Promise<DoorEvent[]> => {
      const [staff, own] = await Promise.all([
        checkinApi.staffEvents().then((r) => r.data),
        organizer ? manageApi.myEvents({ status: "published", limit: 100 }).then((r) => r.data).catch(() => []) : [],
      ]);
      const byId = new Map<string, DoorEvent>();
      for (const e of own) {
        byId.set(e.id, { eventId: e.id, title: e.title, slug: e.slug, status: e.status, startsAt: e.startsAt, endsAt: e.endsAt, role: "organizer" });
      }
      for (const s of staff) if (!byId.has(s.eventId)) byId.set(s.eventId, s);
      return [...byId.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },
    enabled: !!user,
  });
}

export function useDoorStats(eventId: string) {
  return useQuery({
    queryKey: keys.manage.checkIns(eventId),
    queryFn: () => manageApi.checkInStats(eventId),
    refetchInterval: 10_000, // other gates are scanning too
    refetchOnWindowFocus: true,
  });
}

const RECENT = 8;

/**
 * Scan flow for one event. `scan()` ignores input while a request is in flight and ignores
 * the same camera-read code again for a few seconds (a phone held over a QR reads it many times).
 */
export function useScanner(eventId: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<ScanOutcome | null>(null);
  const [recent, setRecent] = useState<(ScanOutcome & { at: number })[]>([]);
  const inFlight = useRef(false);
  const last = useRef<{ code: string; at: number } | null>(null);

  const scan = useCallback(
    async (code: string, opts: { manual?: boolean } = {}) => {
      const now = Date.now();
      if (inFlight.current) return;
      // a QR held in front of the camera is read over and over; typed codes always go through
      if (!opts.manual && last.current && last.current.code === code && now - last.current.at < 8000) return;
      inFlight.current = true;
      last.current = { code, at: now };
      setBusy(true);

      let outcome: ScanOutcome;
      try {
        outcome = toOutcome(code, await checkinApi.checkIn(eventId, code), null);
      } catch (err) {
        outcome = toOutcome(code, null, err);
      }

      buzz(outcome.kind);
      setCurrent(outcome);
      setRecent((r) => [{ ...outcome, at: Date.now() }, ...r].slice(0, RECENT));
      setBusy(false);
      inFlight.current = false;
      if (outcome.kind === "admitted") void qc.invalidateQueries({ queryKey: keys.manage.checkIns(eventId) });
    },
    [eventId, qc],
  );

  const dismiss = useCallback(() => setCurrent(null), []);

  return { scan, busy, current, dismiss, recent };
}

/** Short buzz for yes, a double buzz for no. Silently does nothing where unsupported (iOS). */
function buzz(kind: ScanOutcome["kind"]) {
  try {
    navigator.vibrate?.(kind === "admitted" ? 90 : [220, 90, 220]);
  } catch {
    // ignore
  }
}
