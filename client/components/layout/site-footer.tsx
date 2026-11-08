import Link from "next/link";
import { Logo } from "@/components/ui/logo";

const columns = [
  {
    title: "Discover",
    links: [
      { href: "/events", label: "All events" },
      { href: "/events?category=music", label: "Music" },
      { href: "/events?category=comedy", label: "Comedy" },
      { href: "/events?mode=online", label: "Online" },
    ],
  },
  {
    title: "Organizers",
    links: [
      { href: "/organizer/apply", label: "Host an event" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/account/tickets", label: "My tickets" },
      { href: "/account/bookings", label: "My bookings" },
      { href: "/account", label: "Settings" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-muted">
            Concerts, comedy, film nights and conferences — book in a few taps and keep every ticket in one place.
          </p>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <p className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted">{col.title}</p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[14px] text-ink/80 transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-5 text-[12.5px] text-muted sm:px-8">
          <span>Book Event — Kathmandu, Nepal</span>
          <span>Prices in NPR</span>
        </div>
      </div>
    </footer>
  );
}
