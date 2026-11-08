"use client";

import { ArrowRight, BadgeCheck, CircleAlert, CreditCard, Receipt } from "lucide-react";
import Link from "next/link";
import { DashHeader } from "@/components/dashboard/app-shell";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAdminStats } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en");

/** 1,284 below 10k, then 12.9K / 4.2M (stat tile contract). */
const count = (n: number) => (n < 10_000 ? whole.format(n) : compact.format(n));
/** Paisa → "NPR 4.2M" / "NPR 46,500". */
const money = (paisa: number, currency: string) => `${currency} ${count(Math.round(paisa / 100))}`;

export function AdminOverview() {
  const stats = useAdminStats();

  return (
    <>
      <DashHeader eyebrow="Admin" title="Overview" description="How the platform is doing, and what needs someone's attention." />
      {stats.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[118px] rounded-2xl" />
          ))}
        </div>
      ) : stats.isError ? (
        <EmptyState title="We couldn't load the stats" description={errorMessage(stats.error)} />
      ) : (
        (() => {
          const s = stats.data;
          const revenue = s.revenue.length ? s.revenue : [{ currency: "NPR", amount: 0 }];
          const attention = [
            {
              n: s.organizers.pendingVerification,
              label: "organizer profiles waiting for review",
              href: "/admin/organizers",
              icon: BadgeCheck,
            },
            {
              n: s.refunds.awaitingManualAction,
              label: "manual refunds to pay back by hand (eSewa)",
              href: "/admin/refunds",
              icon: Receipt,
            },
            {
              n: s.refunds.open - s.refunds.awaitingManualAction,
              label: "other refunds still open or failed",
              href: "/admin/refunds?tab=failed",
              icon: Receipt,
            },
            { n: s.payments.failedLast24h, label: "failed payments in the last 24 hours", href: "/admin/payments?status=failed", icon: CreditCard },
          ];
          return (
            <div className="space-y-8">
              <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label="Revenue" value={revenue.map((r) => money(r.amount, r.currency)).join(" · ")} detail="Confirmed bookings, refunds excluded" />
                <Tile label="Confirmed bookings" value={count(s.bookings.confirmed)} detail={`${whole.format(s.bookings.confirmedLast24h)} in the last 24 hours`} />
                <Tile label="Live events" value={count(s.events.live)} detail="Published and not over yet" />
                <Tile label="Users" value={count(s.users.total)} detail={`${whole.format(s.users.newLast7Days)} new in the last 7 days`} />
              </section>

              <section className="rounded-2xl border border-line bg-card">
                <h2 className="border-b border-line px-5 py-4 text-[16px] font-semibold tracking-[-0.015em]">Needs attention</h2>
                <ul className="divide-y divide-line">
                  {attention.map((a) => {
                    const Icon = a.n > 0 ? CircleAlert : a.icon;
                    return (
                      <li key={a.href + a.label}>
                        <Link href={a.href} className="flex items-center gap-4 px-5 py-4 transition hover:bg-ink/[0.02]">
                          <span
                            className={cn(
                              "grid size-9 shrink-0 place-items-center rounded-full",
                              a.n > 0 ? "bg-amber-500/15 text-amber-800" : "bg-ink/[0.05] text-ink/40",
                            )}
                          >
                            <Icon className="size-[18px]" />
                          </span>
                          <p className={cn("flex-1 text-[14.5px]", a.n === 0 && "text-muted")}>
                            <span className="font-mono text-[17px] font-semibold tabular-nums text-ink">{whole.format(a.n)}</span> {a.label}
                            {a.n === 0 && <span className="sr-only"> (nothing to do)</span>}
                          </p>
                          <ArrowRight className="size-4 text-muted" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          );
        })()
      )}
    </>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-2 truncate text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums" title={value}>
        {value}
      </p>
      <p className="mt-2.5 text-[12.5px] text-muted">{detail}</p>
    </div>
  );
}
