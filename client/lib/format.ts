// Display formatters. The API sends money in minor units (paisa) and dates as ISO strings.

const LOCALE = "en-NP";

/** 150000 → "NPR 1,500"; 0 → "Free". Paisa are shown only when non-zero. */
export function formatMoney(paisa: number, currency = "NPR", { freeLabel = "Free" } = {}): string {
  if (paisa === 0 && freeLabel) return freeLabel;
  const amount = paisa / 100;
  const n = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency} ${n}`;
}

/** "NPR 1,500.50" typed by a user → 150050 paisa. Returns null when not a valid amount. */
export function toPaisa(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Event date in the event's own timezone (not the viewer's):
 * same day → "Sat, Dec 12 · 7:00 PM – 10:00 PM", multi-day → "Dec 12 – Dec 14, 2026".
 */
export function formatEventDate(startsAt: string, endsAt?: string | null, timeZone = "Asia/Kathmandu"): string {
  const start = new Date(startsAt);
  const day = new Intl.DateTimeFormat(LOCALE, { weekday: "short", month: "short", day: "numeric", timeZone });
  const time = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit", timeZone });
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone }); // YYYY-MM-DD

  if (!endsAt) return `${day.format(start)} · ${time.format(start)}`;
  const end = new Date(endsAt);
  if (dayKey.format(start) === dayKey.format(end)) {
    return `${day.format(start)} · ${time.format(start)} – ${time.format(end)}`;
  }
  const short = new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", timeZone });
  const year = new Intl.DateTimeFormat(LOCALE, { year: "numeric", timeZone });
  return `${short.format(start)} – ${short.format(end)}, ${year.format(end)}`;
}

/** "Dec 12, 2026" */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago", then a date. */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso);
}

/** "Aarav Sharma" → "AS" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** "::1" / "::ffff:127.0.0.1" → "This computer (localhost)"; strips the IPv4-mapped prefix otherwise. */
export function formatIp(ip: string | null | undefined): string {
  if (!ip) return "Unknown location";
  const clean = ip.replace(/^::ffff:/, "");
  if (clean === "::1" || clean === "127.0.0.1") return "Localhost";
  return clean;
}

/** Rough, friendly device name from a user-agent string ("Chrome on Windows"). */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /PostmanRuntime/.test(ua) ? "Postman"
    : /curl\//.test(ua) ? "curl"
    : "Browser";
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return os ? `${browser} on ${os}` : browser;
}
