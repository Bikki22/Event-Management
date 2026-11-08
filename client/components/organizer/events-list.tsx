"use client";

import { CalendarPlus, ImageOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DashHeader } from "@/components/dashboard/app-shell";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { useMyEvents } from "@/hooks/use-manage";
import { errorMessage } from "@/lib/api/client";
import type { EventStatus } from "@/lib/api/events";
import { MODE_LABEL } from "@/lib/api/events";
import { STATUS, VISIBILITY, type MyEventRow } from "@/lib/api/manage";
import { formatEventDate, formatMoney } from "@/lib/format";

type Filter = "all" | EventStatus;

const TABS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
  { value: "completed", label: "Ended" },
  { value: "cancelled", label: "Cancelled" },
];

export function EventsList() {
  const [filter, setFilter] = useState<Filter>("all");
  const list = useMyEvents(filter === "all" ? undefined : filter);

  return (
    <>
      <DashHeader
        eyebrow="Organizer"
        title="Events"
        description="Drafts, live events and past ones. Open an event to edit it, manage tickets, promo codes and attendees."
        action={
          <LinkButton href="/dashboard/events/new" className="h-10">
            <CalendarPlus className="size-4" /> New event
          </LinkButton>
        }
      />

      <Tabs value={filter} onChange={setFilter} items={TABS} className="mb-6" />

      {list.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState title="We couldn't load your events" description={errorMessage(list.error)} />
      ) : list.events.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus className="size-5" />}
          title={filter === "all" ? "No events yet" : `No ${TABS.find((t) => t.value === filter)?.label.toLowerCase()}`}
          description={filter === "all" ? "Create your first event. It stays a private draft until you publish it." : undefined}
          action={filter === "all" ? <LinkButton href="/dashboard/events/new">Create an event</LinkButton> : undefined}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {list.events.map((e) => (
              <li key={e.id}>
                <EventRow e={e} />
              </li>
            ))}
          </ul>
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

function EventRow({ e }: { e: MyEventRow }) {
  const s = STATUS[e.status];
  const pct = e.ticketsTotal > 0 ? Math.min(100, (e.ticketsSold / e.ticketsTotal) * 100) : 0;
  return (
    <Link
      href={`/dashboard/events/${e.id}`}
      className="group flex gap-4 rounded-2xl border border-line bg-card p-3 transition hover:border-ink/25 sm:items-center sm:p-4"
    >
      <div className="aspect-[16/9] w-28 shrink-0 overflow-hidden rounded-xl bg-ink/[0.05] sm:w-36">
        {e.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- processed variant from our storage
          <img src={e.coverImage.sm} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-ink/25">
            <ImageOff className="size-5" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={s.tone} dot>
            {s.label}
          </Badge>
          {e.visibility !== "public" && <Badge>{VISIBILITY[e.visibility].label}</Badge>}
        </div>
        <p className="mt-1.5 truncate text-[16px] font-semibold tracking-[-0.015em] group-hover:underline group-hover:decoration-accent group-hover:decoration-2 group-hover:underline-offset-4">
          {e.title}
        </p>
        <p className="mt-0.5 truncate text-[13.5px] text-muted">
          {formatEventDate(e.startsAt, e.endsAt, e.timezone)} · {e.venue ? `${e.venue.name}, ${e.venue.city}` : MODE_LABEL[e.mode]}
        </p>
      </div>

      <div className="hidden w-44 shrink-0 text-right sm:block">
        {e.ticketsTotal > 0 ? (
          <>
            <p className="text-[13.5px]">
              <span className="font-semibold">{e.ticketsSold.toLocaleString()}</span>
              <span className="text-muted"> / {e.ticketsTotal.toLocaleString()} sold</span>
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            {e.priceFrom !== null && <p className="mt-1.5 text-[12px] text-muted">from {formatMoney(e.priceFrom, e.currency)}</p>}
          </>
        ) : (
          <p className="text-[13px] text-muted">No tickets yet</p>
        )}
      </div>
    </Link>
  );
}
