import type { Metadata } from "next";
import { Suspense } from "react";
import { BrowseView } from "@/components/events/browse-view";
import { EventCardSkeleton, EventGrid } from "@/components/events/event-card";
import { Container, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Browse events",
  description: "Concerts, comedy, film, food and conferences in Kathmandu, Lalitpur, Pokhara and online.",
};

export default function Page() {
  return (
    <Container className="py-10 sm:py-14">
      <PageHeader
        eyebrow="What's on"
        title="Browse events"
        description="Concerts, comedy, film nights, food fairs and conferences. Filter by date, city or type."
      />
      <div className="mt-8">
        {/* filters live in the URL (useSearchParams), which must sit behind Suspense */}
        <Suspense
          fallback={
            <EventGrid className="mt-24">
              {Array.from({ length: 6 }, (_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </EventGrid>
          }
        >
          <BrowseView />
        </Suspense>
      </div>
    </Container>
  );
}
