"use client";

import { CircleCheckBig, Clock } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { CoverImage } from "@/components/events/cover-image";
import { LinkButton } from "@/components/ui/button";
import type { Booking } from "@/lib/api/bookings";
import { formatEventDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const money = (paisa: number, currency: string) => (paisa === 0 ? "Free" : formatMoney(paisa, currency, { freeLabel: "" }));

/** mm:ss until `expiresAt`; calls onExpire once when it reaches zero. */
export function HoldTimer({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const end = new Date(expiresAt).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, end - Date.now());
      setLeft(ms);
      if (ms === 0) onExpire();
      return ms;
    };
    if (tick() === 0) return;
    const id = window.setInterval(() => {
      if (tick() === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [end, onExpire]);

  if (left === null) return null;
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  const urgent = left < 2 * 60_000;

  return (
    <div
      role="timer"
      aria-live={urgent ? "assertive" : "off"}
      className={cn(
        "flex items-center gap-3 rounded-xl px-4 py-3 text-[14px]",
        urgent ? "bg-accent/10 text-[#9a3412]" : "bg-ink text-paper",
      )}
    >
      <Clock className={cn("size-[18px] shrink-0", urgent ? "text-accent" : "text-accent")} />
      <p className="flex-1">
        {urgent ? "Hurry, your tickets are about to be released." : "Your tickets are held for you."}
      </p>
      <span className="font-mono text-[16px] font-semibold tabular-nums">
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </span>
    </div>
  );
}

export interface SummaryLine {
  name: string;
  quantity: number;
  amount: number; // line total, paisa
}

/** Price breakdown card used by the review and payment steps. */
export function OrderSummary({
  lines,
  subtotal,
  discount,
  total,
  currency,
  promoCode,
  footer,
  bookingCode,
}: {
  lines: SummaryLine[];
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  promoCode?: string | null;
  footer?: React.ReactNode;
  bookingCode?: string;
}) {
  return (
    <section aria-label="Order summary" className="rounded-2xl border border-line bg-card">
      <div className="flex items-baseline justify-between border-b border-line px-5 py-4">
        <h2 className="text-[16px] font-semibold tracking-[-0.015em]">Order summary</h2>
        {bookingCode && <span className="font-mono text-[12px] text-muted">{bookingCode}</span>}
      </div>
      <ul className="space-y-2.5 px-5 py-4 text-[14.5px]">
        {lines.map((l) => (
          <li key={l.name} className="flex justify-between gap-4">
            <span className="text-ink/80">
              {l.quantity} × {l.name}
            </span>
            <span className="tabular-nums">{money(l.amount, currency)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-2 border-t border-line px-5 py-4 text-[14.5px]">
        <div className="flex justify-between">
          <dt className="text-muted">Subtotal</dt>
          <dd className="tabular-nums">{money(subtotal, currency)}</dd>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-green-700">
            <dt>Discount{promoCode ? ` (${promoCode})` : ""}</dt>
            <dd className="tabular-nums">−{formatMoney(discount, currency)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-2">
          <dt className="font-medium">Total</dt>
          <dd className="text-[22px] font-semibold tracking-[-0.03em] tabular-nums">{money(total, currency)}</dd>
        </div>
      </dl>
      {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
    </section>
  );
}

/** Small event header shown at the top of checkout steps. */
export function EventStrip({
  title,
  startsAt,
  endsAt,
  timezone,
  place,
  cover,
}: {
  title: string;
  startsAt: string;
  endsAt?: string | null;
  timezone: string;
  place?: string;
  cover: Booking["event"]["coverImage"];
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-card p-3">
      <div className="w-28 shrink-0 overflow-hidden rounded-xl sm:w-36">
        <CoverImage image={cover} alt="" sizes="144px" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[16px] font-semibold tracking-[-0.02em]">{title}</p>
        <p className="mt-0.5 text-[13.5px] text-muted">{formatEventDate(startsAt, endsAt, timezone)}</p>
        {place && <p className="truncate text-[13.5px] text-muted">{place}</p>}
      </div>
    </div>
  );
}

/** "You're going" screen after a free booking or a verified payment. */
export function BookingConfirmed({ booking, note }: { booking: Booking; note?: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl">
      <motion.div
        initial={{ scale: 0.7 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
        className="grid size-14 place-items-center rounded-full bg-ink"
      >
        <CircleCheckBig className="size-7 text-accent" />
      </motion.div>
      <p className="mt-6 font-mono text-[12px] uppercase tracking-[0.08em] text-muted">Booking {booking.bookingCode}</p>
      <h1 className="mt-2 text-[clamp(2rem,5vw,3rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
        You&apos;re going to {booking.event.title}.
      </h1>
      <p className="mt-3 text-[16px] leading-relaxed text-muted">
        {formatEventDate(booking.event.startsAt, booking.event.endsAt, booking.event.timezone)}. We&apos;ve emailed your
        confirmation, and your tickets are ready below.
      </p>
      {note && <div className="mt-5">{note}</div>}

      <ul className="mt-8 space-y-3">
        {booking.tickets.map((t, i) => (
          <motion.li
            key={t.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-card px-5 py-4"
          >
            <div className="min-w-0">
              <p className="text-[15px] font-medium">{t.ticketType}</p>
              <p className="mt-0.5 font-mono text-[12.5px] text-muted">{t.ticketCode}</p>
            </div>
            <span className="rounded-full bg-green-600/10 px-2.5 py-0.5 text-[12px] font-medium capitalize text-green-800">
              {t.status}
            </span>
          </motion.li>
        ))}
      </ul>

      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href="/account/tickets">View my tickets</LinkButton>
        <LinkButton href={`/events/${booking.event.slug}`} variant="secondary">
          Back to event
        </LinkButton>
      </div>
      <p className="mt-4 text-[13px] text-muted">
        {booking.totalAmount === 0 ? "Free booking, nothing to pay." : `Total paid: ${formatMoney(booking.totalAmount, booking.currency)}`}
      </p>
    </motion.div>
  );
}
