"use client";

import { Check, Download, FileSpreadsheet, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Skeleton, Spinner } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { useAttendeeExport, useAttendees, useCheckInStats, useDebounced } from "@/hooks/use-manage";
import { ApiError, errorMessage } from "@/lib/api/client";
import type { Attendee, AttendeeStatus, ExportJob } from "@/lib/api/manage";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useManagedEvent } from "./event-manage-shell";

type Filter = "all" | AttendeeStatus;

const STATUS_BADGE: Record<AttendeeStatus, { label: string; tone: "success" | "neutral" | "danger" | "dark" }> = {
  valid: { label: "Not checked in", tone: "neutral" },
  checked_in: { label: "Checked in", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
  refunded: { label: "Refunded", tone: "danger" },
};

export function AttendeesPage() {
  const event = useManagedEvent();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const search = useDebounced(q.trim(), 300);
  const list = useAttendees(event.id, {
    ...(search ? { q: search } : {}),
    ...(filter !== "all" ? { status: filter } : {}),
  });
  const stats = useCheckInStats(event.id);

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <CheckInSummary stats={stats.data} loading={stats.isPending} />
        <ExportButton eventId={event.id} />
      </div>

      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All" },
            { value: "valid", label: "Not checked in" },
            { value: "checked_in", label: "Checked in" },
            { value: "refunded", label: "Refunded" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          className="overflow-x-auto [scrollbar-width:none]"
        />
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email, ticket or booking code"
            aria-label="Search attendees"
            className="h-10 w-full rounded-lg border border-line bg-card pl-10 pr-9 text-[14px] placeholder:text-ink/30 focus:border-ink focus:outline-none"
          />
          {list.isFetching && !list.isFetchingNextPage && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2" />}
        </div>
      </div>

      {list.isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : list.isError ? (
        <EmptyState title="We couldn't load attendees" description={errorMessage(list.error)} />
      ) : list.attendees.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title={search || filter !== "all" ? "Nobody matches" : "No attendees yet"}
          description={search || filter !== "all" ? "Try another search or filter." : "Tickets show up here as soon as they're issued."}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full min-w-[760px] text-left text-[14px]">
              <thead className="border-b border-line text-[12px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Attendee</th>
                  <th className="px-5 py-3 font-medium">Ticket</th>
                  <th className="px-5 py-3 font-medium">Booking</th>
                  <th className="px-5 py-3 font-medium">Check-in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.attendees.map((a) => (
                  <AttendeeRow key={a.ticketId} a={a} timeZone={event.timezone} />
                ))}
              </tbody>
            </table>
          </div>
          {list.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function AttendeeRow({ a, timeZone }: { a: Attendee; timeZone: string }) {
  const s = STATUS_BADGE[a.status];
  const time = a.checkedInAt
    ? new Intl.DateTimeFormat("en-NP", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(a.checkedInAt))
    : null;
  return (
    <tr className={cn((a.status === "cancelled" || a.status === "refunded") && "text-muted")}>
      <td className="px-5 py-3.5">
        <p className="font-medium">{a.name}</p>
        <p className="text-[13px] text-muted">{a.email}</p>
        {a.name !== a.buyer.name && <p className="text-[12px] text-muted">Bought by {a.buyer.name}</p>}
      </td>
      <td className="px-5 py-3.5">
        <p>{a.ticketType}</p>
        <p className="font-mono text-[12px] text-muted">{a.ticketCode}</p>
      </td>
      <td className="px-5 py-3.5">
        <p className="font-mono text-[13px]">{a.bookingCode}</p>
        <p className="text-[12.5px] text-muted">{formatMoney(a.price, a.currency)}</p>
      </td>
      <td className="px-5 py-3.5">
        {a.status === "checked_in" ? (
          <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-green-800">
            <Check className="size-4" /> {time}
          </span>
        ) : (
          <Badge tone={s.tone}>{s.label}</Badge>
        )}
      </td>
    </tr>
  );
}

function CheckInSummary({ stats, loading }: { stats?: { issued: number; checkedIn: number }; loading: boolean }) {
  if (loading) return <Skeleton className="h-[76px] rounded-2xl" />;
  if (!stats) return <div />;
  const pct = stats.issued ? Math.round((stats.checkedIn / stats.issued) * 100) : 0;
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[14px] text-muted">
          <span className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{stats.checkedIn.toLocaleString()}</span> of{" "}
          {stats.issued.toLocaleString()} checked in
        </p>
        <span className="font-mono text-[12px] text-muted">{pct}%</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** POST export → poll until the worker has written the CSV → download link. */
function ExportButton({ eventId }: { eventId: string }) {
  const { start, job, reset } = useAttendeeExport(eventId);
  const [slow, setSlow] = useState(false);
  const running = start.isPending || job?.status === "queued" || job?.status === "processing";

  const onStart = () => {
    setSlow(false);
    start.mutate(undefined, {
      onError: (err) =>
        toast.error(
          err instanceof ApiError && err.code === "EXPORT_IN_PROGRESS"
            ? "An export for this event is already running. You'll also get an email when it's ready."
            : errorMessage(err),
        ),
    });
  };

  // the worker normally finishes in seconds; after 20 s say why it may be stuck
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setSlow(true), 20_000);
    return () => window.clearTimeout(t);
  }, [running]);

  if (job?.status === "ready" && job.downloadUrl) return <ReadyLink job={job} onDone={reset} />;

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      <Button variant="secondary" onClick={onStart} loading={running} className="h-11">
        <FileSpreadsheet className="size-4" /> {running ? "Preparing CSV…" : "Export CSV"}
      </Button>
      {job?.status === "failed" && (
        <p role="alert" className="text-[12.5px] text-red-600">
          The export failed{job.error ? `: ${job.error}` : ""}. Try again.
        </p>
      )}
      {running && (
        <p className="max-w-64 text-[12.5px] text-muted sm:text-right">
          {slow
            ? "Taking longer than usual. Is the worker running (npm run dev:worker)? We'll email you when it's ready."
            : "Usually a few seconds. We'll email you too."}
        </p>
      )}
    </div>
  );
}

function ReadyLink({ job, onDone }: { job: ExportJob; onDone: () => void }) {
  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      <a
        href={job.downloadUrl!}
        download
        onClick={() => window.setTimeout(onDone, 1000)}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-ink px-5 text-[14px] font-medium text-paper transition hover:bg-ink/85"
      >
        <Download className="size-4" /> Download CSV
      </a>
      <p className="text-[12.5px] text-muted">
        {job.rowCount?.toLocaleString() ?? 0} rows · link valid for 10 minutes
      </p>
    </div>
  );
}
