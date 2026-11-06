"use client";

import { ArrowUpRight } from "lucide-react";
import { motion } from "motion/react";

// sample listings for the poster panel (illustrative, not live data)
const listings = [
  { date: "DEC 12", day: "SAT", title: "Neon Nights Festival", place: "Tundikhel, Kathmandu", tag: "Music" },
  { date: "DEC 19", day: "SAT", title: "Stand-up at the Square", place: "Patan Durbar Square", tag: "Comedy" },
  { date: "JAN 08", day: "FRI", title: "Indie Film Premiere", place: "QFX Labim Mall", tag: "Film" },
  { date: "JAN 23", day: "SAT", title: "Pokhara Street Food Fair", place: "Lakeside, Pokhara", tag: "Food" },
  { date: "FEB 22", day: "MON", title: "Himalayan Tech Summit", place: "Hyatt Regency", tag: "Talks" },
];

const ease = [0.22, 1, 0.36, 1] as const;

export function Showcase() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-ink p-10 text-paper xl:p-12">
      <div className="flex items-center justify-between font-mono text-[11.5px] uppercase tracking-[0.08em]">
        <span className="flex items-center gap-2 text-paper/70"><span className="size-1.5 rounded-full bg-accent" />Now booking</span>
        <span className="text-paper/40">Winter 26 / 27</span>
      </div>

      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
        className="mt-10 text-[clamp(3rem,5.4vw,5.25rem)] font-semibold leading-[0.92] tracking-[-0.05em]"
      >
        Good nights
        <br />
        get booked
        <br />
        <span className="text-accent">early.</span>
      </motion.h2>

      <ul className="mt-auto">
        {listings.map((l, i) => (
          <motion.li
            key={l.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.06, duration: 0.45, ease }}
            className="group grid cursor-default grid-cols-[64px_1fr_auto] items-center gap-4 border-t border-paper/10 py-3.5 last:border-b"
          >
            <span className="font-mono text-[12px] leading-tight text-accent">
              {l.date}
              <span className="block text-paper/35">{l.day}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[16px] font-medium tracking-[-0.01em]">{l.title}</span>
              <span className="block truncate text-[13px] text-paper/45">{l.place}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="rounded-full border border-paper/15 px-2.5 py-0.5 text-[11.5px] text-paper/60">{l.tag}</span>
              <ArrowUpRight className="size-4 -translate-x-1 opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100 text-accent" />
            </span>
          </motion.li>
        ))}
      </ul>

      <p className="mt-6 font-mono text-[11.5px] uppercase tracking-[0.08em] text-paper/35">
        Concerts — Comedy — Film — Food — Talks
      </p>
    </div>
  );
}
