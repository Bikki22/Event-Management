"use client";

import { ChevronRight, ScrollText } from "lucide-react";
import { useState } from "react";
import { DashHeader } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/data-table";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAuditLog } from "@/hooks/use-admin";
import { useDebounced } from "@/hooks/use-manage";
import type { AuditEntry } from "@/lib/api/admin";
import { errorMessage } from "@/lib/api/client";
import { formatIp } from "@/lib/format";
import { cn } from "@/lib/utils";

// action prefixes written by the server (grep `action: "` in server/src)
const GROUPS = [
  { value: "", label: "Everything" },
  { value: "admin.", label: "Admin actions" },
  { value: "organizer.", label: "Organizers" },
  { value: "event.", label: "Events" },
  { value: "ticket_type.", label: "Ticket types" },
  { value: "promo_code.", label: "Promo codes" },
  { value: "booking.", label: "Bookings" },
  { value: "auth.", label: "Sign-in & passwords" },
  { value: "venue.", label: "Venues" },
];


const when = (iso: string) =>
  new Intl.DateTimeFormat("en-NP", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(
    new Date(iso),
  );

/** `from`/`to` as ISO: the `to` date is inclusive for people, exclusive for the API. */
function range(from: string, to: string) {
  const day = (d: string, plus = 0) => {
    const t = new Date(`${d}T00:00:00`);
    t.setDate(t.getDate() + plus);
    return t.toISOString();
  };
  return { from: from ? day(from) : undefined, to: to ? day(to, 1) : undefined };
}

export function AdminAuditLog() {
  const [group, setGroup] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const exactAction = useDebounced(action.trim(), 300);
  const entityId = useDebounced(entity.trim(), 300);

  const list = useAuditLog({
    action: exactAction || group || undefined,
    entityId: entityId || undefined,
    ...range(from, to),
  });

  return (
    <>
      <DashHeader eyebrow="Admin" title="Audit log" description="Every write on the platform: who did what, when, from where, and what changed. Append-only." />

      <div className="mb-4 flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => {
              setGroup(g.value);
              setAction("");
            }}
            aria-pressed={group === g.value && !action}
            className={cn(
              "h-9 rounded-full border px-3.5 text-[13px] transition",
              group === g.value && !action ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink/70 hover:border-ink/30",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <SearchInput value={action} onChange={setAction} placeholder="Action, e.g. event.published" label="Filter by action" />
        <SearchInput value={entity} onChange={setEntity} placeholder="Entity id (event, user, booking…)" label="Filter by entity id" />
        <label className="flex items-center gap-2 text-[13px] text-muted">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-lg border border-line bg-card px-2.5 text-[14px] text-ink focus:border-ink focus:outline-none" />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-lg border border-line bg-card px-2.5 text-[14px] text-ink focus:border-ink focus:outline-none" />
        </label>
      </div>

      {list.isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : list.isError ? (
        <EmptyState title="We couldn't load the audit log" description={errorMessage(list.error)} />
      ) : list.rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-5" />} title="No entries match" description="Try a wider date range or another filter." />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
            {list.rows.map((e) => (
              <Entry key={e.id} e={e} />
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load older
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Entry({ e }: { e: AuditEntry }) {
  const hasDiff = e.diff !== null && e.diff !== undefined && !(typeof e.diff === "object" && Object.keys(e.diff as object).length === 0);
  const body = (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="font-mono text-[13px] font-semibold">{e.action}</span>
      <span className="text-[13.5px]">
        {e.actor ? (e.actor.name ?? e.actor.email ?? e.actor.id) : <span className="text-muted">System</span>}
      </span>
      <span className="font-mono text-[12px] text-muted">
        {e.entityType}
        {e.entityId && ` ${e.entityId.length > 12 ? `…${e.entityId.slice(-8)}` : e.entityId}`}
      </span>
      <span className="ml-auto whitespace-nowrap text-[12.5px] text-muted">
        {when(e.createdAt)}
        {e.ip && ` · ${formatIp(e.ip)}`}
      </span>
    </div>
  );

  if (!hasDiff) return <li className="flex items-center gap-3 px-5 py-3.5 pl-12">{body}</li>;
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 transition hover:bg-ink/[0.02] [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 text-muted transition group-open:rotate-90" />
          {body}
        </summary>
        <div className="px-5 pb-4 pl-12">
          {e.entityId && <p className="mb-2 font-mono text-[12px] text-muted">id: {e.entityId}</p>}
          <pre className="overflow-x-auto rounded-lg bg-ink/[0.04] p-3 font-mono text-[12px] leading-relaxed">{JSON.stringify(e.diff, null, 2)}</pre>
        </div>
      </details>
    </li>
  );
}
