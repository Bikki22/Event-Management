"use client";

import { CalendarX2, CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/primitives";
import { useEventList } from "@/hooks/use-events";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { BrowseFilters } from "./browse-filters";
import { EventCard, EventCardSkeleton, EventGrid } from "./event-card";
import { useBrowseFilters } from "./use-browse-filters";

/** Search + filters + infinite results. Used by /events and /categories/[slug]. */
export function BrowseView({ lockedCategory }: { lockedCategory?: string }) {
  const { state, update, clear, apiFilters, activeCount } = useBrowseFilters(lockedCategory);
  const list = useEventList(apiFilters);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = list;

  // load the next page when the sentinel scrolls into view
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refreshing = list.isPlaceholderData && list.isFetching;

  return (
    <div>
      <BrowseFilters state={state} update={update} clear={clear} activeCount={activeCount} hideCategory={!!lockedCategory} />

      <div className="mt-8 flex items-baseline justify-between gap-4">
        <p className="text-[14px] text-muted" aria-live="polite">
          {list.isPending
            ? "Finding events…"
            : list.isError
              ? ""
              : `${list.events.length}${hasNextPage ? "+" : ""} ${list.events.length === 1 ? "event" : "events"}${state.q ? ` for “${state.q}”` : ""}`}
        </p>
        {refreshing && <Spinner className="size-4" label="Updating results" />}
      </div>

      <div className="mt-4">
        {list.isPending ? (
          <EventGrid>
            {Array.from({ length: 6 }, (_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </EventGrid>
        ) : list.isError ? (
          <EmptyState
            icon={<CircleAlert className="size-5" />}
            title="We couldn't load events"
            description={errorMessage(list.error)}
            action={<Button onClick={() => list.refetch()}>Try again</Button>}
          />
        ) : list.events.length === 0 ? (
          <EmptyState
            icon={<CalendarX2 className="size-5" />}
            title="No events match"
            description="Try a different search, another date, or clear the filters to see everything coming up."
            action={
              activeCount > 0 ? (
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <EventGrid className={cn("transition-opacity duration-200", refreshing && "opacity-60")}>
              {list.events.map((e, i) => (
                <EventCard key={e.id} event={e} priority={i < 3} />
              ))}
            </EventGrid>

            <div ref={sentinel} className="mt-10 flex justify-center">
              {hasNextPage ? (
                <Button variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
                  {isFetchingNextPage ? "Loading more" : "Load more events"}
                </Button>
              ) : (
                list.events.length > 6 && <p className="text-[13.5px] text-muted">You&apos;ve reached the end.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
