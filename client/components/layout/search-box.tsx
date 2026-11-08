"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Sends the query to /events?q=…; the browse page (Phase 3) reads it from the URL. */
export function SearchBox({ className, onSubmitted }: { className?: string; onSubmitted?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        router.push(query ? `/events?q=${encodeURIComponent(query)}` : "/events");
        onSubmitted?.();
      }}
      className={cn("relative", className)}
    >
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search events, artists, venues"
        aria-label="Search events"
        className="h-10 w-full rounded-full border border-line bg-card pl-9 pr-4 text-[14px] placeholder:text-ink/35 transition focus:border-ink focus:outline-none focus:shadow-[0_0_0_3px_rgb(255_90_31/0.18)]"
      />
    </form>
  );
}
