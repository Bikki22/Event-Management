"use client";

import { ArrowRight, ArrowUpRight, Search } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EventCard, EventCardSkeleton, EventGrid } from "@/components/events/event-card";
import { Container } from "@/components/layout/page-header";
import { LinkButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { useAuth } from "@/hooks/use-auth";
import { useCategories, useEventRow } from "@/hooks/use-events";

const ease = [0.22, 1, 0.36, 1] as const;

export function HomeView() {
  return (
    <>
      <Hero />
      <CategoryStrip />
      <ThisWeek />
      <ComingUp />
      <HostBand />
    </>
  );
}

function Hero() {
  const { status, user } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState("");
  const signedIn = status === "authenticated" && user;

  return (
    <Container className="pb-14 pt-16 sm:pb-20 sm:pt-24">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }} className="max-w-3xl">
        <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">
          <span className="mr-2 inline-block size-2 rounded-full bg-accent align-middle" />
          {signedIn ? `Welcome back, ${user.fullName.split(" ")[0]}` : "Now booking — winter season"}
        </p>
        <h1 className="mt-6 text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[0.95] tracking-[-0.05em]">
          Find something good to do this weekend.
        </h1>
        <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-muted">
          Concerts, comedy, film nights and conferences. Book in a few taps, and keep every ticket in one place.
        </p>

        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const query = q.trim();
            router.push(query ? `/events?q=${encodeURIComponent(query)}` : "/events");
          }}
          className="mt-10 flex max-w-xl gap-2"
        >
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Try “jazz”, “comedy” or “Pokhara”"
              aria-label="Search events"
              className="h-12 w-full rounded-xl border border-line bg-card pl-11 pr-4 text-[15px] placeholder:text-ink/35 transition focus:border-ink focus:outline-none focus:shadow-[0_0_0_3px_rgb(255_90_31/0.18)]"
            />
          </div>
          <button
            type="submit"
            className="h-12 rounded-xl bg-ink px-5 text-[14px] font-medium text-paper transition-colors hover:bg-ink/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            Search
          </button>
        </form>
      </motion.div>
    </Container>
  );
}

function CategoryStrip() {
  const { data, isPending } = useCategories();
  return (
    <Container>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden">
        {isPending
          ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10 w-28 shrink-0 rounded-full" />)
          : data?.map((c) => (
              <Link
                key={c.id}
                href={`/categories/${c.slug}`}
                className="inline-flex h-10 shrink-0 items-center rounded-full border border-line bg-card px-4 text-[14px] text-ink/80 transition hover:border-ink hover:text-ink"
              >
                {c.name}
              </Link>
            ))}
      </div>
    </Container>
  );
}

function RowHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 className="text-[26px] font-semibold tracking-[-0.035em] sm:text-[30px]">{title}</h2>
      <Link href={href} className="group inline-flex shrink-0 items-center gap-1 text-[14px] font-medium text-ink/70 hover:text-ink">
        {linkLabel}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function ThisWeek() {
  const filters = useMemo(() => ({ when: "week" as const, limit: 6 }), []);
  const { data, isPending, isError } = useEventRow(filters);
  if (isError || (!isPending && data?.length === 0)) return null;

  return (
    <Container className="mt-16 sm:mt-20">
      <RowHeader title="This week" href="/events?when=week" linkLabel="See all" />
      {/* horizontal scroller on phones, grid on larger screens */}
      <div className="-mx-5 mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
        {isPending
          ? Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="w-[78vw] shrink-0 snap-start sm:w-[340px] lg:w-auto">
                <EventCardSkeleton />
              </div>
            ))
          : data?.map((e, i) => (
              <div key={e.id} className="w-[78vw] shrink-0 snap-start sm:w-[340px] lg:w-auto">
                <EventCard event={e} priority={i < 3} className="h-full" />
              </div>
            ))}
      </div>
    </Container>
  );
}

function ComingUp() {
  const filters = useMemo(() => ({ when: "later" as const, limit: 9 }), []);
  const { data, isPending, isError } = useEventRow(filters);
  if (isError) return null;

  return (
    <Container className="mt-16 sm:mt-20">
      <RowHeader title="Later this season" href="/events" linkLabel="Browse all events" />
      <EventGrid className="mt-6">
        {isPending
          ? Array.from({ length: 6 }, (_, i) => <EventCardSkeleton key={i} />)
          : data?.map((e) => <EventCard key={e.id} event={e} />)}
      </EventGrid>
    </Container>
  );
}

function HostBand() {
  return (
    <Container className="mb-20 mt-20 sm:mt-24">
      <div className="relative overflow-hidden rounded-2xl bg-ink p-8 text-paper sm:p-12">
        <p className="flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-paper/60">
          <span className="size-1.5 rounded-full bg-accent" /> For organizers
        </p>
        <h2 className="mt-5 max-w-xl text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1] tracking-[-0.045em]">
          Run your own show. <span className="text-accent">Sell out the room.</span>
        </h2>
        <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-paper/60">
          Create an event in minutes, sell tickets with Khalti, eSewa or card, and check guests in with your phone.
        </p>
        <LinkButton href="/organizer/apply" className="group mt-8 bg-paper text-ink hover:bg-paper/90">
          Become an organizer <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </LinkButton>
      </div>
    </Container>
  );
}
