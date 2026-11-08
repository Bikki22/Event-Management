// Date-range presets for the browse filters, computed in Kathmandu time (UTC+05:45, no DST),
// so "today" means today in Nepal regardless of the visitor's own timezone.

const OFFSET_MS = (5 * 60 + 45) * 60_000;

/** "later" (after the next 7 days) isn't offered in the filters; the home page uses it so its rows don't repeat. */
export type WhenPreset = "today" | "tomorrow" | "weekend" | "week" | "month" | "later";

export const WHEN_OPTIONS: { value: WhenPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "Next 30 days" },
];

export const isWhenPreset = (v: string | null): v is WhenPreset => WHEN_OPTIONS.some((o) => o.value === v);

/** Midnight (Kathmandu) `days` from today, as a real instant. */
function ktmMidnight(days: number, now = new Date()): Date {
  const local = new Date(now.getTime() + OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days) - OFFSET_MS);
}

/** Day of week in Kathmandu, 0 = Sunday … 6 = Saturday. */
function ktmWeekday(now = new Date()): number {
  return new Date(now.getTime() + OFFSET_MS).getUTCDay();
}

/** `from`/`to` (ISO) for GET /events. Nepal's weekly holiday is Saturday, so "weekend" = Friday + Saturday. */
export function rangeFor(preset: WhenPreset, now = new Date()): { from: string; to?: string } {
  const iso = (d: Date) => d.toISOString();
  switch (preset) {
    case "today":
      return { from: iso(now), to: iso(ktmMidnight(1, now)) };
    case "tomorrow":
      return { from: iso(ktmMidnight(1, now)), to: iso(ktmMidnight(2, now)) };
    case "weekend": {
      const day = ktmWeekday(now);
      // days until Friday (5); if it's already Friday or Saturday, start now
      const toFriday = day === 5 || day === 6 ? 0 : (5 - day + 7) % 7;
      const toSunday = (7 - day) % 7 || 7; // end of Saturday
      const from = toFriday === 0 ? now : ktmMidnight(toFriday, now);
      return { from: iso(from), to: iso(ktmMidnight(toSunday, now)) };
    }
    case "week":
      return { from: iso(now), to: iso(ktmMidnight(8, now)) };
    case "month":
      return { from: iso(now), to: iso(ktmMidnight(31, now)) };
    case "later":
      return { from: iso(ktmMidnight(8, now)) };
  }
}

/** "Fri" / "12" / "DEC" for the date stub on event cards. */
export function dateParts(iso: string, timeZone = "Asia/Kathmandu") {
  const d = new Date(iso);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...o, timeZone }).format(d);
  return {
    weekday: part({ weekday: "short" }),
    day: part({ day: "numeric" }),
    month: part({ month: "short" }).toUpperCase(),
    time: new Intl.DateTimeFormat("en-NP", { hour: "numeric", minute: "2-digit", timeZone }).format(d),
  };
}
