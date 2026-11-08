"use client";

import { ChevronRight, CircleAlert, MapPin, Ticket, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CoverImage } from "@/components/events/cover-image";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { useMyTickets } from "@/hooks/use-my-tickets";
import { errorMessage } from "@/lib/api/client";
import { TICKET_STATUS, type TicketSummary } from "@/lib/api/tickets";
import { formatEventDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "upcoming" | "all";

/** Consecutive tickets of the same event become one group (the list is newest first). */
function groupByEvent(tickets: TicketSummary[]) {
  const groups: { event: TicketSummary["event"]; tickets: TicketSummary[] }[] = [];
  for (const t of tickets) {
    const last = groups.at(-1);
    if (last && last.event.id === t.event.id) last.tickets.push(t);
    else groups.push({ event: t.event, tickets: [t] });
  }
  return groups;
}

export function TicketsList() {
  const [view, setView] = useState<View>("upcoming");
  // "Upcoming" = tickets you can still use; refunded/cancelled ones live under "All tickets"
  const list = useMyTickets(view === "upcoming" ? { upcoming: true, status: "valid" } : {});

  return (
    <div>
      <Tabs
        value={view}
        onChange={setView}
        items={[
          { value: "upcoming", label: "Upcoming" },
          { value: "all", label: "All tickets" },
        ]}
      />

      <div className="mt-6">
        {list.isPending ? (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState
            icon={<CircleAlert className="size-5" />}
            title="We couldn't load your tickets"
            description={errorMessage(list.error)}
            action={<Button onClick={() => list.refetch()}>Try again</Button>}
          />
        ) : list.tickets.length === 0 ? (
          <EmptyState
            icon={<Ticket className="size-5" />}
            title={view === "upcoming" ? "No upcoming tickets" : "No tickets yet"}
            description={
              view === "upcoming"
                ? "Tickets for events you've booked show up here, with a QR code for the door."
                : "Once you book an event, every ticket you own appears here."
            }
            action={<LinkButton href="/events">Browse events</LinkButton>}
          />
        ) : (
          <div className={cn("space-y-4 transition-opacity", list.isPlaceholderData && "opacity-60")}>
            {groupByEvent(list.tickets).map((g) => (
              <EventGroup key={`${g.event.id}-${g.tickets[0].id}`} event={g.event} tickets={g.tickets} />
            ))}
            {list.hasNextPage && (
              <div className="flex justify-center pt-4">
                <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EventGroup({ event, tickets }: { event: TicketSummary["event"]; tickets: TicketSummary[] }) {
  const cancelled = event.status === "cancelled";
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <Link href={`/events/${event.slug}`} className="flex items-center gap-4 border-b border-line p-4 transition hover:bg-ink/[0.02]">
        <div className="w-24 shrink-0 overflow-hidden rounded-lg sm:w-28">
          <CoverImage image={event.coverImage} alt="" sizes="112px" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold tracking-[-0.02em]">{event.title}</p>
          <p className="mt-0.5 text-[13.5px] text-muted">{formatEventDate(event.startsAt, event.endsAt, event.timezone)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted">
            {event.mode === "online" ? <Video className="size-3.5" /> : <MapPin className="size-3.5" />}
            {event.mode === "online" ? "Online" : event.venue ? `${event.venue.name}, ${event.venue.city}` : "Venue TBA"}
          </p>
        </div>
        {cancelled && <Badge tone="danger">Event cancelled</Badge>}
      </Link>
      <ul className="divide-y divide-line">
        {tickets.map((t) => {
          const s = TICKET_STATUS[t.status];
          return (
            <li key={t.id}>
              <Link
                href={`/account/tickets/${t.id}`}
                className="group flex items-center gap-4 px-4 py-3.5 transition hover:bg-ink/[0.02] focus-visible:bg-ink/[0.03] focus-visible:outline-none"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink/[0.05] text-ink/70">
                  <Ticket className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-medium">{t.ticketType.name}</span>
                  <span className="block truncate font-mono text-[12px] text-muted">
                    {t.ticketCode}
                    {t.holderName ? ` · ${t.holderName}` : ""}
                  </span>
                </span>
                <Badge tone={s.tone}>{s.label}</Badge>
                <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
