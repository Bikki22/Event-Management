import { MapPin, Video } from "lucide-react";
import Link from "next/link";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { dateParts } from "@/lib/dates";
import type { EventCard as EventCardData } from "@/lib/api/events";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CoverImage } from "./cover-image";

export function priceLabel(e: Pick<EventCardData, "priceFrom" | "currency">) {
  if (e.priceFrom === null) return null;
  return e.priceFrom === 0 ? "Free" : `From ${formatMoney(e.priceFrom, e.currency)}`;
}

export function placeLabel(e: Pick<EventCardData, "mode" | "venue">) {
  if (e.mode === "online") return "Online";
  const place = e.venue ? `${e.venue.name}, ${e.venue.city}` : "Venue to be announced";
  return e.mode === "hybrid" ? `${place} · Online` : place;
}

export function EventCard({ event, priority, className }: { event: EventCardData; priority?: boolean; className?: string }) {
  const d = dateParts(event.startsAt, event.timezone);
  const price = priceLabel(event);

  return (
    <Link
      href={`/events/${event.slug}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition duration-300 hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-[0_18px_40px_-24px_rgb(22_22_20/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      <div className="relative overflow-hidden">
        <CoverImage
          image={event.coverImage}
          alt=""
          priority={priority}
          label={event.category?.name}
          className="transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
        {/* ticket-stub date */}
        <div className="absolute left-3 top-3 rounded-lg bg-paper px-2.5 py-1.5 text-center shadow-sm">
          <p className="font-mono text-[10.5px] leading-none text-muted">{d.month}</p>
          <p className="mt-1 text-[19px] font-semibold leading-none tracking-[-0.03em]">{d.day}</p>
        </div>
        {event.soldOut && (
          <Badge tone="dark" className="absolute right-3 top-3">
            Sold out
          </Badge>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4 pt-3.5">
        <p className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted">
          {d.weekday} · {d.time}
          {event.category && <span className="text-ink/35"> · {event.category.name}</span>}
        </p>
        <h3 className="mt-1.5 line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.02em] text-ink">
          {event.title}
        </h3>
        <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13.5px] text-muted">
          {event.mode === "online" ? <Video className="size-3.5 shrink-0" /> : <MapPin className="size-3.5 shrink-0" />}
          <span className="truncate">{placeLabel(event)}</span>
        </p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className={cn("text-[14px] font-medium", event.soldOut ? "text-muted line-through" : "text-ink")}>
            {price ?? "Tickets soon"}
          </span>
          <span className="truncate text-[12.5px] text-muted">{event.organizer.orgName}</span>
        </div>
      </div>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <Skeleton className="aspect-[16/9] w-full rounded-none" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-2/3" />
        <div className="flex justify-between pt-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

export function EventGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-5 sm:grid-cols-2 lg:grid-cols-3", className)}>{children}</div>;
}
