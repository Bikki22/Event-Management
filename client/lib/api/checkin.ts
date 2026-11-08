import { api, ApiError } from "./client";
import type { EventStatus } from "./events";
import type { StaffRole } from "./manage";

// Door check-in (server/src/modules/tickets/checkins.service.ts, tickets.md "Check-in & staff").

/** Row of GET /me/staff-events: events I was added to as door staff. */
export interface StaffEvent {
  eventId: string;
  title: string;
  slug: string;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  role: StaffRole;
}

export interface AdmittedTicket {
  id: string;
  ticketCode: string;
  ticketType: string;
  holderName: string;
  bookingCode: string;
  checkedInAt: string;
}

export const checkinApi = {
  staffEvents: () => api<{ data: StaffEvent[] }>("/me/staff-events"),
  checkIn: (eventId: string, ticketCode: string) =>
    api<{ result: "admitted"; ticket: AdmittedTicket }>(`/events/${encodeURIComponent(eventId)}/check-ins`, {
      method: "POST",
      body: { ticketCode },
    }),
};

/** What a scan resolved to, ready for the result screen. */
export type ScanOutcome =
  | { kind: "admitted"; code: string; ticket: AdmittedTicket }
  | { kind: "already"; code: string; holderName: string | null; checkedInAt: string | null; checkedInBy: string | null }
  | { kind: "rejected"; code: string; title: string; detail: string }
  | { kind: "error"; code: string; title: string; detail: string };

const CODE = /^TKT-[0-9A-Z]{16}$/;

/**
 * Scanners send what the QR holds (`TKT-…`); people typing at the door often skip the prefix,
 * add spaces or use lowercase. Returns null when it can't be a ticket code.
 */
export function normalizeCode(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  const withPrefix = /^[0-9A-Z]{16}$/.test(s) ? `TKT-${s}` : s.replace(/^TKT(?!-)/, "TKT-");
  return CODE.test(withPrefix) ? withPrefix : null;
}

/** Turns any API answer into an outcome; never throws (the door must keep moving). */
export function toOutcome(code: string, res: { ticket: AdmittedTicket } | null, err: unknown): ScanOutcome {
  if (res) return { kind: "admitted", code, ticket: res.ticket };
  if (err instanceof ApiError) {
    const d = (err.details ?? {}) as { checkedInAt?: string; checkedInBy?: string | null; holderName?: string; status?: string };
    switch (err.code) {
      case "ALREADY_CHECKED_IN":
        return { kind: "already", code, holderName: d.holderName ?? null, checkedInAt: d.checkedInAt ?? null, checkedInBy: d.checkedInBy ?? null };
      case "TICKET_NOT_FOUND":
        return { kind: "rejected", code, title: "Unknown ticket", detail: "No ticket has this code. Check it's a Book Event ticket." };
      case "WRONG_EVENT":
        return { kind: "rejected", code, title: "Wrong event", detail: "This ticket is for a different event." };
      case "TICKET_NOT_VALID":
        return {
          kind: "rejected",
          code,
          title: d.status === "refunded" ? "Refunded ticket" : d.status === "cancelled" ? "Cancelled ticket" : "Not valid",
          detail: d.status === "refunded" ? "This ticket was refunded and can't be used." : "This ticket was cancelled and can't be used.",
        };
      case "EVENT_NOT_ACTIVE":
        return { kind: "rejected", code, title: "Check-in closed", detail: err.message };
      case "VALIDATION_FAILED":
        return { kind: "rejected", code, title: "Not a ticket", detail: "That code isn't a Book Event ticket code." };
      case "NOT_FOUND":
        return { kind: "error", code, title: "No access", detail: "You're not on the door staff for this event." };
      case "NETWORK_ERROR":
        return { kind: "error", code, title: "No connection", detail: "Not checked in. Check the connection and scan again." };
      case "RATE_LIMITED":
        return { kind: "error", code, title: "Too fast", detail: "Wait a few seconds, then scan again." };
    }
    return { kind: "error", code, title: "Couldn't check in", detail: err.message };
  }
  return { kind: "error", code, title: "Couldn't check in", detail: "Something went wrong. Scan again." };
}
