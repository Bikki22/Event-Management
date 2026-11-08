// Wall-clock times in an event's own time zone, for <input type="datetime-local">.
// An organizer in Pokhara and one travelling abroad must both type "7:00 PM" and mean 7 PM
// at the venue, so the browser's own zone is never used here.

function partsIn(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  return p;
}

/** Offset of `timeZone` from UTC at `date`, in ms (Kathmandu → +20 700 000). */
function offsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** ISO instant → "2026-12-20T18:00" as seen in `timeZone`. Empty string for null. */
export function toLocalInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const p = partsIn(new Date(iso), timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "2026-12-20T18:00" in `timeZone` → ISO instant (UTC). Null when the input is empty or malformed. */
export function fromLocalInput(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // two passes settle the offset around DST changes
  let t = wall - offsetMs(new Date(wall), timeZone);
  t = wall - offsetMs(new Date(t), timeZone);
  return new Date(t).toISOString();
}

/** "UTC+05:45" for labels. */
export function offsetLabel(timeZone: string, at = new Date()): string {
  const mins = Math.round(offsetMs(at, timeZone) / 60_000);
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Every IANA zone the browser knows, with the common Nepal zone first. */
export function timeZoneOptions(): { value: string; label: string }[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Asia/Kathmandu", "UTC"];
  const zones = ["Asia/Kathmandu", ...all.filter((z) => z !== "Asia/Kathmandu" && z !== "Asia/Katmandu")];
  return zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
}
