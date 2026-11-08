"use client";

import { ChevronRight, ScanLine } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { useDoorEvents, type DoorEvent } from "@/hooks/use-check-in";
import { useNow } from "@/hooks/use-now";
import { errorMessage } from "@/lib/api/client";
import { formatEventDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<DoorEvent["role"], string> = {
  organizer: "Your event",
  manager: "Manager",
  scanner: "Scanner",
};

/** Doors open a few hours early; show those events as "now". */
const OPEN_BEFORE_MS = 3 * 60 * 60 * 1000;

export function DoorEventPicker() {
  const events = useDoorEvents();
  const now = useNow();

  const live = (e: DoorEvent) =>
    now !== null && e.status === "published" && new Date(e.startsAt).getTime() - OPEN_BEFORE_MS <= now && now < new Date(e.endsAt).getTime();
  const past = (e: DoorEvent) => e.status === "completed" || (now !== null && new Date(e.endsAt).getTime() <= now);

  const list = events.data ?? [];
  const groups = [
    { title: "Happening now", items: list.filter(live) },
    { title: "Coming up", items: list.filter((e) => !live(e) && !past(e)) },
    { title: "Past", items: list.filter(past).reverse() },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-16 pt-5">
      <header className="flex items-center justify-between">
        {/* Logo is already a link to home; invert it for the dark background */}
        <span className="invert">
          <Logo />
        </span>
        <span className="rounded-md bg-paper/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-paper/70">Door</span>
      </header>

      <h1 className="mt-10 text-[30px] font-semibold leading-tight tracking-[-0.03em]">Check in guests</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-paper/60">Pick the event you&apos;re working at, then scan tickets at the entrance.</p>

      <div className="mt-8 space-y-8">
        {events.isPending ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-paper/[0.06]" />
            ))}
          </div>
        ) : events.isError ? (
          <p className="rounded-2xl bg-red-500/15 px-5 py-4 text-[15px] text-red-200">{errorMessage(events.error)}</p>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-paper/15 px-6 py-12 text-center">
            <ScanLine className="mx-auto size-8 text-paper/40" />
            <p className="mt-4 text-[17px] font-semibold">No events to scan for</p>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-paper/55">
              Ask the organizer to add your email as door staff. Events show up here once they&apos;re published.
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.title}>
              <h2 className="mb-3 font-mono text-[11.5px] uppercase tracking-[0.08em] text-paper/45">{g.title}</h2>
              <ul className="space-y-2.5">
                {g.items.map((e) => (
                  <li key={e.eventId}>
                    <Link
                      href={`/check-in/${e.eventId}`}
                      className={cn(
                        "flex min-h-[76px] items-center gap-4 rounded-2xl px-5 py-4 transition active:scale-[0.99]",
                        live(e) ? "bg-paper text-ink" : "bg-paper/[0.07] hover:bg-paper/[0.11]",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[17px] font-semibold tracking-[-0.015em]">{e.title}</p>
                        <p className={cn("mt-0.5 truncate text-[13.5px]", live(e) ? "text-ink/60" : "text-paper/55")}>
                          {formatEventDate(e.startsAt, e.endsAt)} · {ROLE_LABEL[e.role]}
                        </p>
                      </div>
                      <ChevronRight className={cn("size-5 shrink-0", live(e) ? "text-accent" : "text-paper/40")} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
