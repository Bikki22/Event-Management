"use client";

import { Minus, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { useAvailability } from "@/hooks/use-events";
import { useNow } from "@/hooks/use-now";
import type { PublicEvent, PublicTicketType } from "@/lib/api/events";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCheckoutStore } from "@/stores/checkout-store";

const LOW_STOCK = 20;


type Line = PublicTicketType & { qty: number };

function unavailableReason(t: PublicTicketType, now: number | null): string | null {
  if (t.onSale) return null;
  if (t.soldOut) return "Sold out";
  if (now && t.salesStartAt && new Date(t.salesStartAt).getTime() > now) return `On sale ${formatDate(t.salesStartAt)}`;
  if (now && t.salesEndAt && new Date(t.salesEndAt).getTime() <= now) return "Sales ended";
  return "Not on sale";
}

export function TicketPanel({ event }: { event: PublicEvent }) {
  const router = useRouter();
  const now = useNow();
  const startCheckout = useCheckoutStore((s) => s.start);
  const [qty, setQty] = useState<Record<string, number>>({});

  const ended = now !== null && new Date(event.endsAt).getTime() <= now;
  const closed = event.status === "cancelled" || event.status === "completed" || ended;
  const live = useAvailability(event.id, !closed);

  // merge live stock into the (cached) ticket types from the server render
  const lines: Line[] = useMemo(() => {
    const byId = new Map(live.data?.ticketTypes.map((a) => [a.ticketTypeId, a]));
    return event.ticketTypes.map((t) => {
      const a = byId.get(t.id);
      const merged = a ? { ...t, available: a.available, soldOut: a.soldOut, onSale: a.onSale } : t;
      const max = Math.min(merged.maxPerOrder, merged.available);
      return { ...merged, qty: Math.min(qty[t.id] ?? 0, merged.onSale ? max : 0) };
    });
  }, [event.ticketTypes, live.data, qty]);

  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0);
  const currency = lines[0]?.currency ?? event.currency;
  const allFree = lines.length > 0 && lines.every((l) => l.price === 0);

  const change = (t: Line, delta: 1 | -1) => {
    const max = Math.min(t.maxPerOrder, t.available);
    let next = t.qty + delta;
    // the first tap jumps to the minimum order size; going below it empties the line
    if (delta === 1 && t.qty === 0) next = Math.max(1, t.minPerOrder);
    if (delta === -1 && next < t.minPerOrder) next = 0;
    setQty((q) => ({ ...q, [t.id]: Math.max(0, Math.min(next, max)) }));
  };

  const checkout = () => {
    startCheckout({
      eventId: event.id,
      eventSlug: event.slug,
      eventTitle: event.title,
      currency,
      lines: lines.map((l) => ({ ticketTypeId: l.id, name: l.name, unitPrice: l.price, quantity: l.qty })),
    });
    router.push(`/checkout/${event.id}`);
  };

  return (
    <section id="tickets" aria-labelledby="tickets-heading" className="scroll-mt-24 rounded-2xl border border-line bg-card">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id="tickets-heading" className="text-[16px] font-semibold tracking-[-0.015em]">
          Tickets
        </h2>
        {live.isFetching && !closed && <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Updating</span>}
      </div>

      {closed ? (
        <p className="px-5 py-6 text-[14.5px] text-muted">
          {event.status === "cancelled"
            ? "This event was cancelled. Ticket holders are refunded automatically."
            : "This event has ended. Tickets are no longer on sale."}
        </p>
      ) : lines.length === 0 ? (
        <p className="px-5 py-6 text-[14.5px] text-muted">Tickets haven&apos;t been released yet. Check back soon.</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {lines.map((t) => {
              const reason = unavailableReason(t, now);
              const max = Math.min(t.maxPerOrder, t.available);
              return (
                <li key={t.id} className={cn("flex items-start gap-4 px-5 py-4", reason && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{t.name}</p>
                    <p className="mt-0.5 text-[14px]">{t.price === 0 ? "Free" : formatMoney(t.price, t.currency)}</p>
                    {t.description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{t.description}</p>}
                    {!reason && t.available <= LOW_STOCK && (
                      <Badge tone="accent" className="mt-2">
                        Only {t.available} left
                      </Badge>
                    )}
                  </div>
                  {reason ? (
                    <span className="shrink-0 pt-0.5 text-[13px] font-medium text-muted">{reason}</span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${t.name} quantity`}>
                      <StepButton label={`Remove one ${t.name}`} disabled={t.qty === 0} onClick={() => change(t, -1)}>
                        <Minus className="size-3.5" />
                      </StepButton>
                      <span className="w-7 text-center text-[15px] font-medium tabular-nums" aria-live="polite">
                        {t.qty}
                      </span>
                      <StepButton label={`Add one ${t.name}`} disabled={t.qty >= max} onClick={() => change(t, 1)}>
                        <Plus className="size-3.5" />
                      </StepButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-line px-5 py-4">
            <AnimatePresence initial={false}>
              {count > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mb-4 flex items-baseline justify-between text-[14.5px]">
                    <span className="text-muted">
                      {count} {count === 1 ? "ticket" : "tickets"}
                    </span>
                    <span className="text-[18px] font-semibold tracking-[-0.02em]">
                      {total === 0 ? "Free" : formatMoney(total, currency)}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Button className="w-full" disabled={count === 0} onClick={checkout}>
              {count === 0 ? "Select tickets" : allFree || total === 0 ? "Reserve tickets" : "Continue to checkout"}
            </Button>
            <p className="mt-3 text-center text-[12px] text-muted">Seats are held for 10 minutes while you check out.</p>
          </div>
        </>
      )}
    </section>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full border border-line text-ink transition hover:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}
