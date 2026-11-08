import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EventPage } from "@/components/events/event-page";
import { Container } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/primitives";
import { getPublicEvent } from "@/lib/server/public-data";

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) return { title: "Event not found" };

  const description = event.summary ?? `Tickets for ${event.title} on Book Event.`;
  const images = event.coverImage ? [{ url: event.coverImage.lg, width: 1600, height: 900, alt: event.title }] : [];
  return {
    title: event.title,
    description,
    openGraph: { title: event.title, description, images, type: "website" },
    twitter: { card: images.length ? "summary_large_image" : "summary", title: event.title, description },
  };
}

// The slug is runtime data (no generateStaticParams), so it's awaited inside <Suspense>:
// the shell renders instantly and the cached event streams in. See docs: dynamic-routes#with-cache-components.
export default function Page({ params }: PageProps<"/events/[slug]">) {
  return (
    <Suspense fallback={<EventPageSkeleton />}>
      <EventContent params={params} />
    </Suspense>
  );
}

async function EventContent({ params }: Pick<PageProps<"/events/[slug]">, "params">) {
  const { slug } = await params;
  const event = await getPublicEvent(slug);
  if (!event) notFound();
  return <EventPage event={event} />;
}

function EventPageSkeleton() {
  return (
    <Container className="pt-8">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-5 aspect-[16/9] max-h-[520px] w-full rounded-2xl" />
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-8 h-28 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    </Container>
  );
}
