import { BadgeCheck, CalendarX2, Globe } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EventCard, EventCardSkeleton, EventGrid } from "@/components/events/event-card";
import { Container } from "@/components/layout/page-header";
import { Avatar, EmptyState, Skeleton } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { getPublicOrganizer } from "@/lib/server/public-data";

export async function generateMetadata({ params }: PageProps<"/organizers/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicOrganizer(slug);
  if (!data) return { title: "Organizer not found" };
  const { organizer } = data;
  return {
    title: organizer.orgName,
    description: organizer.bio ?? `Upcoming events by ${organizer.orgName} on Book Event.`,
    openGraph: { title: organizer.orgName, images: organizer.logoUrl ? [organizer.logoUrl] : [] },
  };
}

export default function Page({ params }: PageProps<"/organizers/[slug]">) {
  return (
    <Suspense fallback={<OrganizerSkeleton />}>
      <OrganizerContent params={params} />
    </Suspense>
  );
}

async function OrganizerContent({ params }: Pick<PageProps<"/organizers/[slug]">, "params">) {
  const { slug } = await params;
  const data = await getPublicOrganizer(slug);
  if (!data) notFound();
  const { organizer, upcomingEvents } = data;
  const site = organizer.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <Container className="py-10 sm:py-14">
      <header className="flex flex-col gap-6 border-b border-line pb-10 sm:flex-row sm:items-center">
        <Avatar name={organizer.orgName} src={organizer.logoUrl} className="size-20 rounded-2xl text-[22px]" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted">Organizer</p>
          <h1 className="mt-2 flex flex-wrap items-center gap-2 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[40px]">
            {organizer.orgName}
            {organizer.verified && <BadgeCheck className="size-7 text-accent" aria-label="Verified organizer" />}
          </h1>
          {organizer.bio && <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-muted">{organizer.bio}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-muted">
            {site && (
              <a
                href={organizer.website!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-ink underline decoration-accent decoration-2 underline-offset-4"
              >
                <Globe className="size-3.5" /> {site}
              </a>
            )}
            <span>On Book Event since {formatDate(organizer.memberSince)}</span>
            {organizer.verified && <span>Verified organizer</span>}
          </div>
        </div>
      </header>

      <section className="mt-10">
        <h2 className="text-[20px] font-semibold tracking-[-0.025em]">
          Upcoming events <span className="text-muted">{upcomingEvents.length}</span>
        </h2>
        {upcomingEvents.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={<CalendarX2 className="size-5" />}
            title="Nothing scheduled right now"
            description={`${organizer.orgName} hasn't announced new events yet. Check back soon.`}
          />
        ) : (
          <EventGrid className="mt-6">
            {upcomingEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </EventGrid>
        )}
      </section>
    </Container>
  );
}

function OrganizerSkeleton() {
  return (
    <Container className="py-14">
      <div className="flex items-center gap-6 border-b border-line pb-10">
        <Skeleton className="size-20 rounded-2xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </div>
      <EventGrid className="mt-16">
        {Array.from({ length: 3 }, (_, i) => (
          <EventCardSkeleton key={i} />
        ))}
      </EventGrid>
    </Container>
  );
}
