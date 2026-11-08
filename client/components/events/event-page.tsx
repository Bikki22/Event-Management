import { BadgeCheck, CalendarDays, ExternalLink, MapPin, Video } from "lucide-react";
import Link from "next/link";
import { Container } from "@/components/layout/page-header";
import { Avatar, Badge } from "@/components/ui/primitives";
import { MODE_LABEL, type PublicEvent } from "@/lib/api/events";
import { formatEventDate } from "@/lib/format";
import { CoverImage } from "./cover-image";
import { priceLabel } from "./event-card";
import { Faqs, MobileTicketBar, ShareButton } from "./event-extras";
import { TicketPanel } from "./ticket-panel";

/** Server-rendered event page; only the ticket panel and small extras are client components. */
export function EventPage({ event }: { event: PublicEvent }) {
  const tags = event.metadata?.tags ?? [];
  const faqs = event.metadata?.faqs ?? [];
  const activePrices = event.ticketTypes.map((t) => t.price);
  const from = activePrices.length ? Math.min(...activePrices) : null;
  const price = priceLabel({ priceFrom: from, currency: event.currency });

  return (
    <>
      <EventJsonLd event={event} />

      <Container className="pb-28 pt-6 sm:pt-8 lg:pb-20">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-muted">
          <Link href="/events" className="hover:text-ink">
            Events
          </Link>
          {event.category && (
            <>
              <span aria-hidden>/</span>
              <Link href={`/categories/${event.category.slug}`} className="hover:text-ink">
                {event.category.name}
              </Link>
            </>
          )}
        </nav>

        {event.status === "cancelled" && (
          <div className="mt-5 rounded-xl border-l-[3px] border-red-500 bg-red-50 px-4 py-3 text-[14px] text-red-900">
            <p className="font-medium">This event has been cancelled.</p>
            {event.cancellationReason && <p className="mt-0.5 text-red-900/75">{event.cancellationReason}</p>}
          </div>
        )}

        <div className="mt-5 overflow-hidden rounded-2xl border border-line">
          <CoverImage
            image={event.coverImage}
            alt={`Cover image for ${event.title}`}
            priority
            sizes="(min-width: 1152px) 1088px, 100vw"
            label={event.category?.name}
            className="max-h-[520px]"
          />
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {event.category && <Badge>{event.category.name}</Badge>}
              <Badge tone="neutral">{MODE_LABEL[event.mode]}</Badge>
            </div>
            <h1 className="mt-4 text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
              {event.title}
            </h1>
            {event.summary && <p className="mt-4 max-w-2xl text-[18px] leading-relaxed text-muted">{event.summary}</p>}

            <div className="mt-6">
              <ShareButton title={event.title} />
            </div>

            <dl className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
              <Fact icon={<CalendarDays className="size-[18px]" />} label="Date and time">
                {formatEventDate(event.startsAt, event.endsAt, event.timezone)}
                <span className="mt-0.5 block text-[13px] text-muted">{event.timezone.replace("_", " ")} time</span>
              </Fact>
              <Fact
                icon={event.mode === "online" ? <Video className="size-[18px]" /> : <MapPin className="size-[18px]" />}
                label="Location"
              >
                <Location event={event} />
              </Fact>
            </dl>

            {event.description && (
              <Block title="About this event">
                <div className="space-y-4 text-[16px] leading-[1.7] text-ink/85">
                  {event.description.split(/\n{2,}/).map((p, i) => (
                    <p key={i} className="whitespace-pre-line">
                      {p}
                    </p>
                  ))}
                </div>
              </Block>
            )}

            {tags.length > 0 && (
              <ul className="mt-6 flex flex-wrap gap-2" aria-label="Tags">
                {tags.map((t) => (
                  <li key={t}>
                    <Link
                      href={`/events?q=${encodeURIComponent(t)}`}
                      className="rounded-full border border-line px-3 py-1 text-[13px] text-ink/70 transition hover:border-ink/30 hover:text-ink"
                    >
                      #{t}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {faqs.length > 0 && (
              <Block title="Good to know">
                <Faqs items={faqs} />
              </Block>
            )}

            <Block title="Organizer">
              <Link
                href={`/organizers/${event.organizer.slug}`}
                className="group flex items-center gap-4 rounded-2xl border border-line bg-card p-4 transition hover:border-ink/20"
              >
                <Avatar name={event.organizer.orgName} src={event.organizer.logoUrl} className="size-12 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[15.5px] font-medium">
                    {event.organizer.orgName}
                    {event.organizer.verified && <BadgeCheck className="size-4 shrink-0 text-accent" aria-label="Verified organizer" />}
                  </p>
                  <p className="text-[13.5px] text-muted">See all events by this organizer</p>
                </div>
                <span className="text-[13.5px] font-medium text-ink/60 transition group-hover:text-ink">View →</span>
              </Link>
            </Block>
          </div>

          <aside className="lg:pt-1">
            <div className="lg:sticky lg:top-24">
              <TicketPanel event={event} />
            </div>
          </aside>
        </div>
      </Container>

      {event.status === "published" && <MobileTicketBar price={price} />}
    </>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5 bg-card p-5">
      <span className="mt-0.5 text-accent">{icon}</span>
      <div className="min-w-0">
        <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{label}</dt>
        <dd className="mt-1.5 text-[15px] font-medium leading-snug">{children}</dd>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-5 text-[20px] font-semibold tracking-[-0.025em]">{title}</h2>
      {children}
    </section>
  );
}

function Location({ event }: { event: PublicEvent }) {
  const v = event.venue;
  const online = (
    <span className="mt-0.5 block text-[13px] font-normal text-muted">The online link is shared with ticket holders.</span>
  );
  if (event.mode === "online" || !v) {
    return (
      <>
        Online event
        {online}
      </>
    );
  }
  const query = v.latitude !== null && v.longitude !== null ? `${v.latitude},${v.longitude}` : `${v.name}, ${v.city}`;
  return (
    <>
      {v.name}
      <span className="mt-0.5 block text-[13px] font-normal text-muted">
        {[v.addressLine, v.city].filter(Boolean).join(", ")}
      </span>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-normal text-ink underline decoration-accent decoration-2 underline-offset-4"
      >
        Open in Maps <ExternalLink className="size-3" />
      </a>
      {event.mode === "hybrid" && online}
    </>
  );
}

/** schema.org Event, so search engines can show date, place and price. */
function EventJsonLd({ event }: { event: PublicEvent }) {
  const attendance = {
    in_person: "https://schema.org/OfflineEventAttendanceMode",
    online: "https://schema.org/OnlineEventAttendanceMode",
    hybrid: "https://schema.org/MixedEventAttendanceMode",
  }[event.mode];
  const place = event.venue
    ? {
        "@type": "Place",
        name: event.venue.name,
        address: { "@type": "PostalAddress", streetAddress: event.venue.addressLine ?? undefined, addressLocality: event.venue.city, addressCountry: "NP" },
      }
    : undefined;
  const data = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.summary ?? undefined,
    startDate: event.startsAt,
    endDate: event.endsAt,
    eventStatus: event.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: attendance,
    // the real online link is only revealed to ticket holders
    location: event.mode === "online" ? { "@type": "VirtualLocation" } : place,
    image: event.coverImage ? [event.coverImage.lg] : undefined,
    organizer: { "@type": "Organization", name: event.organizer.orgName },
    offers: event.ticketTypes.map((t) => ({
      "@type": "Offer",
      name: t.name,
      price: (t.price / 100).toFixed(2),
      priceCurrency: t.currency,
      availability: t.soldOut ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
    })),
  };
  return (
    <script
      type="application/ld+json"
      // escape "<" so the JSON can't close the script tag
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
