import Link from "next/link";
import { cn } from "@/lib/utils";

export const APP_NAME = "Book Event";

/** Ticket-stub mark: a tilted ticket with a perforation line and an orange "booked" punch. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <g transform="rotate(-12 16 16)">
        <path
          d="M8.5 10.5H23.5a2 2 0 0 1 2 2V13.6a2.4 2.4 0 0 0 0 4.8V19.5a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2V18.4a2.4 2.4 0 0 0 0-4.8V12.5a2 2 0 0 1 2-2Z"
          fill="var(--paper)"
        />
        <path d="M19.5 12v8" stroke="var(--ink)" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="0.1 2.4" />
        <circle cx="13" cy="16" r="2.3" fill="var(--accent)" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label={`${APP_NAME} home`}
      className={cn("group inline-flex items-center gap-2.5 text-ink", className)}
    >
      <LogoMark className="transition-transform duration-300 group-hover:-rotate-6" />
      <span className="text-[17px] font-semibold tracking-[-0.03em]">
        Book Event
      </span>
    </Link>
  );
}
