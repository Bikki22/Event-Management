"use client";

import { ChevronRight, CircleAlert, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CoverImage } from "@/components/events/cover-image";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Skeleton } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { useMyBookings } from "@/hooks/use-my-tickets";
import { BOOKING_STATUS, type Booking, type BookingStatus } from "@/lib/api/bookings";
import { errorMessage } from "@/lib/api/client";
import { formatDate, formatEventDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | BookingStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Awaiting payment" },
  { value: "refunded", label: "Refunded" },
  { value: "cancelled", label: "Cancelled" },
];

export function BookingsList() {
  const [filter, setFilter] = useState<Filter>("all");
  const list = useMyBookings(filter === "all" ? undefined : filter);

  return (
    <div>
      <div className="-mx-5 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <Tabs value={filter} onChange={setFilter} items={FILTERS} className="min-w-max" />
      </div>

      <div className="mt-6">
        {list.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState
            icon={<CircleAlert className="size-5" />}
            title="We couldn't load your bookings"
            description={errorMessage(list.error)}
            action={<Button onClick={() => list.refetch()}>Try again</Button>}
          />
        ) : list.bookings.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-5" />}
            title={filter === "all" ? "No bookings yet" : `No ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} bookings`}
            description="Every order you place shows up here with its payment and refund status."
            action={filter === "all" ? <LinkButton href="/events">Browse events</LinkButton> : undefined}
          />
        ) : (
          <ul className={cn("space-y-3 transition-opacity", list.isPlaceholderData && "opacity-60")}>
            {list.bookings.map((b) => (
              <li key={b.id}>
                <BookingRow booking={b} />
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div className="flex justify-center pt-6">
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function BookingRow({ booking: b }: { booking: Booking }) {
  const s = BOOKING_STATUS[b.status];
  const count = b.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <Link
      href={`/account/bookings/${b.id}`}
      className="group flex items-center gap-4 rounded-2xl border border-line bg-card p-3 pr-4 transition hover:border-ink/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="hidden w-28 shrink-0 overflow-hidden rounded-xl sm:block">
        <CoverImage image={b.event.coverImage} alt="" sizes="112px" />
      </div>
      <div className="min-w-0 flex-1 py-1 pl-1 sm:pl-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[15.5px] font-semibold tracking-[-0.015em]">{b.event.title}</p>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <p className="mt-0.5 text-[13.5px] text-muted">{formatEventDate(b.event.startsAt, b.event.endsAt, b.event.timezone)}</p>
        <p className="mt-0.5 text-[12.5px] text-muted">
          <span className="font-mono">{b.bookingCode}</span> · {count} {count === 1 ? "ticket" : "tickets"} · booked {formatDate(b.createdAt)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-[15px] font-semibold tabular-nums">{b.totalAmount === 0 ? "Free" : formatMoney(b.totalAmount, b.currency)}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
