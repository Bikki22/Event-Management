"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock, ShoppingBag, TimerOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { placeLabel } from "@/components/events/event-card";
import { Container } from "@/components/layout/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { EmptyState, PageLoader, Section } from "@/components/ui/primitives";
import { useAuth, useResendVerification } from "@/hooks/use-auth";
import { useBooking, useCancelBooking, useCreateBooking, useProviders, useStartPayment } from "@/hooks/use-checkout";
import {
  bookingsApi,
  goToGateway,
  PROVIDER_INFO,
  type Booking,
  type PromoPreview,
  type ProviderName,
} from "@/lib/api/bookings";
import { ApiError, errorMessage } from "@/lib/api/client";
import { eventsApi, type PublicEvent } from "@/lib/api/events";
import { keys } from "@/lib/api/keys";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hydrateCheckout, useCheckoutStore, type CheckoutLine } from "@/stores/checkout-store";
import { BookingConfirmed, EventStrip, HoldTimer, OrderSummary } from "./parts";

/**
 * Checkout for one event:
 *   review (tickets, promo, contact) → POST /bookings → pending: pay (hold timer + gateway)
 *                                                    → confirmed (free): tickets
 * The pending booking id lives in the checkout store, so a refresh or a trip to the gateway
 * resumes at the right step.
 */
export function CheckoutView() {
  const { eventId } = useParams<{ eventId: string }>();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void hydrateCheckout().then(() => setHydrated(true));
  }, []);

  const store = useCheckoutStore();
  const sameEvent = store.eventId === eventId;
  const booking = useBooking(hydrated && sameEvent ? store.bookingId : null);

  if (!hydrated || (store.bookingId && sameEvent && booking.isPending)) return <PageLoader />;

  if (!sameEvent || (store.lines.length === 0 && !store.bookingId)) {
    return (
      <Container className="py-16">
        <EmptyState
          icon={<ShoppingBag className="size-5" />}
          title="No tickets selected"
          description="Pick tickets on an event page to start checking out."
          action={<LinkButton href="/events">Browse events</LinkButton>}
        />
      </Container>
    );
  }

  const b = booking.data;
  if (b?.status === "confirmed") {
    return (
      <Container className="py-12 sm:py-16">
        <BookingConfirmed booking={b} />
      </Container>
    );
  }
  if (b?.status === "pending") return <PayStep booking={b} onExpired={() => booking.refetch()} />;
  if (b && (b.status === "expired" || b.status === "cancelled")) return <ExpiredStep booking={b} />;

  return <ReviewStep eventId={eventId} />;
}

// ───────────── step 1: review ─────────────

function ReviewStep({ eventId }: { eventId: string }) {
  const { user } = useAuth();
  const { lines: picked, eventSlug, setBookingId } = useCheckoutStore();
  const create = useCreateBooking();
  const resend = useResendVerification();

  // fresh event data: current names/prices, and drop anything no longer on sale
  const event = useQuery({
    queryKey: keys.events.detail(eventId),
    queryFn: async () => (await eventsApi.get(eventId)).event,
  });

  const lines: CheckoutLine[] = useMemo(() => {
    if (!event.data) return picked;
    const types = new Map(event.data.ticketTypes.map((t) => [t.id, t]));
    return picked.flatMap((l) => {
      const t = types.get(l.ticketTypeId);
      return t && t.onSale ? [{ ...l, name: t.name, unitPrice: t.price }] : [];
    });
  }, [event.data, picked]);
  const dropped = event.data ? picked.length - lines.length : 0;

  const [phone, setPhone] = useState(user?.phone ?? "");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ code: string; preview: PromoPreview } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const currency = event.data?.currency ?? "NPR";
  const items = lines.map((l) => ({ ticketTypeId: l.ticketTypeId, quantity: l.quantity }));
  const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  const discount = promo?.preview.preview.discountAmount ?? 0;
  const total = Math.max(0, subtotal - discount);
  const verified = !!user?.emailVerified;

  const submit = () => {
    setFormError(null);
    const p = phone.trim();
    if (p && !/^\+?[0-9 ()-]{7,20}$/.test(p)) {
      setPhoneError("Enter a valid phone number");
      return;
    }
    setPhoneError(null);
    create.mutate(
      { eventId, items, ...(promo ? { promoCode: promo.code } : {}), ...(p ? { contactPhone: p } : {}) },
      {
        onSuccess: (booking) => {
          setBookingId(booking.id);
          if (booking.status === "confirmed") toast.success("You're going!", { description: "Your tickets are ready." });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "TICKET_SOLD_OUT") {
            setFormError(`${err.message}. Go back to the event to change your selection.`);
          } else if (err instanceof ApiError && err.code.startsWith("PROMO_CODE")) {
            setPromo(null);
            setFormError(`${err.message}. The code was removed; you can continue without it.`);
          } else if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
            setFormError("Verify your email before booking. Check your inbox for the link.");
          } else {
            setFormError(errorMessage(err));
          }
        },
      },
    );
  };

  return (
    <Container className="py-8 sm:py-12">
      <CheckoutHeader backHref={eventSlug ? `/events/${eventSlug}#tickets` : "/events"} backLabel="Back to event" step={1} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
        <div className="min-w-0 space-y-6">
          {event.data && <EventStripFor event={event.data} />}

          {!verified && (
            <FormAlert message="Verify your email to book tickets. We sent a link when you signed up.">
              <button
                type="button"
                disabled={resend.isPending}
                onClick={() =>
                  resend.mutate(undefined, {
                    onSuccess: () => toast.success("Verification email sent"),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
                className="ml-1 font-medium underline underline-offset-4 disabled:opacity-60"
              >
                {resend.isPending ? "Sending…" : "Resend email"}
              </button>
            </FormAlert>
          )}

          {dropped > 0 && (
            <FormAlert message="Some tickets you picked are no longer on sale and were removed from your order." />
          )}

          <Section
            title="Your tickets"
            action={
              eventSlug && (
                <Link href={`/events/${eventSlug}#tickets`} className="text-[13.5px] font-medium text-ink underline underline-offset-4">
                  Change
                </Link>
              )
            }
          >
            <ul className="-my-3 divide-y divide-line">
              {lines.map((l) => (
                <li key={l.ticketTypeId} className="flex items-center justify-between gap-4 py-3 text-[15px]">
                  <span>
                    <span className="font-medium">{l.name}</span>
                    <span className="text-muted"> × {l.quantity}</span>
                  </span>
                  <span className="tabular-nums">{l.unitPrice === 0 ? "Free" : formatMoney(l.unitPrice * l.quantity, currency)}</span>
                </li>
              ))}
            </ul>
          </Section>

          {subtotal > 0 && (
            <PromoField eventId={eventId} items={items} applied={promo} onChange={setPromo} disabled={lines.length === 0} />
          )}

          <Section title="Contact" description="Your confirmation and tickets go to this email.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Email" value={user?.email ?? ""} readOnly disabled className="cursor-not-allowed bg-paper text-muted" />
              <Field
                label="Phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="98XXXXXXXX"
                labelAside={<span className="text-[12px] text-muted">Optional</span>}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={phoneError ?? undefined}
              />
            </div>
          </Section>
        </div>

        <aside>
          <div className="space-y-4 lg:sticky lg:top-24">
            <OrderSummary
              lines={lines.map((l) => ({ name: l.name, quantity: l.quantity, amount: l.unitPrice * l.quantity }))}
              subtotal={subtotal}
              discount={discount}
              total={total}
              currency={currency}
              promoCode={promo?.code}
              footer={
                <>
                  <FormAlert message={formError} />
                  <Button
                    className={cn("w-full", formError && "mt-4")}
                    loading={create.isPending}
                    disabled={!verified || lines.length === 0 || event.isPending}
                    onClick={submit}
                  >
                    {total === 0 ? "Get tickets" : "Reserve and continue to payment"}
                  </Button>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-muted">
                    <Lock className="size-3" />
                    {total === 0 ? "Free tickets are confirmed instantly." : "Tickets are held for 10 minutes while you pay."}
                  </p>
                </>
              }
            />
          </div>
        </aside>
      </div>
    </Container>
  );
}

function EventStripFor({ event }: { event: PublicEvent }) {
  return (
    <EventStrip
      title={event.title}
      startsAt={event.startsAt}
      endsAt={event.endsAt}
      timezone={event.timezone}
      cover={event.coverImage}
      place={placeLabel({ mode: event.mode, venue: event.venue ? { name: event.venue.name, city: event.venue.city } : null })}
    />
  );
}

function PromoField({
  eventId,
  items,
  applied,
  onChange,
  disabled,
}: {
  eventId: string;
  items: { ticketTypeId: string; quantity: number }[];
  applied: { code: string; preview: PromoPreview } | null;
  onChange: (p: { code: string; preview: PromoPreview } | null) => void;
  disabled?: boolean;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // quantities changed (e.g. a ticket dropped): the preview no longer applies
  const itemsKey = JSON.stringify(items);
  const [appliedFor, setAppliedFor] = useState(itemsKey);
  if (applied && appliedFor !== itemsKey) {
    setAppliedFor(itemsKey);
    onChange(null);
  }

  const apply = async () => {
    const c = code.trim();
    if (c.length < 3) return setError("Enter a promo code");
    setChecking(true);
    setError(null);
    try {
      const preview = await bookingsApi.validatePromo({ eventId, code: c, items });
      setAppliedFor(itemsKey);
      onChange({ code: c.toUpperCase(), preview });
      setCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Section title="Promo code">
      {applied ? (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-green-600/[0.07] px-4 py-3 text-[14.5px]">
          <span>
            <span className="font-mono font-medium">{applied.code}</span>
            <span className="text-green-800">
              {" "}
              applied:{" "}
              {applied.preview.discountType === "percent"
                ? `${applied.preview.discountValue}% off`
                : `${formatMoney(applied.preview.discountValue)} off`}
            </span>
          </span>
          <button type="button" onClick={() => onChange(null)} className="text-[13.5px] text-muted underline underline-offset-4 hover:text-ink">
            Remove
          </button>
        </div>
      ) : (
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void apply();
          }}
        >
          <div className="flex-1">
            <Field
              label="Have a code? Enter it here"
              className="font-mono uppercase placeholder:normal-case"
              placeholder="e.g. EARLY20"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={error ?? undefined}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <Button type="submit" variant="secondary" className="mt-[26px]" loading={checking} disabled={disabled}>
            Apply
          </Button>
        </form>
      )}
    </Section>
  );
}

// ───────────── step 2: pay ─────────────

function PayStep({ booking, onExpired }: { booking: Booking; onExpired: () => void }) {
  const providers = useProviders();
  const start = useStartPayment();
  const cancel = useCancelBooking();
  const { setBookingId, forgetAttempt } = useCheckoutStore();
  const [provider, setProvider] = useState<ProviderName | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // each visit to this step is a new payment attempt (e.g. after coming back from a failed one);
  // within the visit the same key protects against double clicks
  useEffect(() => forgetAttempt("payment"), [forgetAttempt]);

  const available = useMemo(
    () => (providers.data ?? []).filter((p) => p.currencies.includes(booking.currency)),
    [providers.data, booking.currency],
  );
  const chosen = provider ?? available[0]?.name ?? null;

  // the server expires the hold on its own schedule; switch screens as soon as the clock runs out
  const [expired, setExpired] = useState(false);
  const handleExpire = useCallback(() => {
    setExpired(true);
    onExpired();
  }, [onExpired]);

  const pay = () => {
    if (!chosen) return;
    setError(null);
    start.mutate(
      { bookingId: booking.id, provider: chosen },
      {
        onSuccess: ({ action }) => goToGateway(action), // leaves the page; the button stays busy
        onError: (err) => {
          if (err instanceof ApiError && (err.code === "BOOKING_EXPIRED" || err.code === "BOOKING_NOT_PAYABLE")) handleExpire();
          else setError(errorMessage(err));
        },
      },
    );
  };

  if (expired) return <ExpiredStep booking={booking} />;

  return (
    <Container className="py-8 sm:py-12">
      <CheckoutHeader backHref={`/events/${booking.event.slug}`} backLabel="Back to event" step={2} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
        <div className="min-w-0 space-y-6">
          {booking.expiresAt && <HoldTimer expiresAt={booking.expiresAt} onExpire={handleExpire} />}
          <EventStrip
            title={booking.event.title}
            startsAt={booking.event.startsAt}
            endsAt={booking.event.endsAt}
            timezone={booking.event.timezone}
            cover={booking.event.coverImage}
          />

          <Section title="Payment method" description="You'll be taken to the provider to pay, then brought back here.">
            {providers.isPending ? (
              <p className="text-[14px] text-muted">Loading payment methods…</p>
            ) : available.length === 0 ? (
              <FormAlert message="No payment method is available for this currency right now." />
            ) : (
              <div role="radiogroup" aria-label="Payment method" className="grid gap-3">
                {available.map((p) => {
                  const info = PROVIDER_INFO[p.name];
                  const active = chosen === p.name;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setProvider(p.name)}
                      className={cn(
                        "flex items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        active ? "border-ink bg-ink/[0.02] shadow-[0_0_0_1px_var(--ink)]" : "border-line hover:border-ink/30",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-5 shrink-0 place-items-center rounded-full border-2",
                          active ? "border-ink" : "border-line",
                        )}
                      >
                        {active && <span className="size-2.5 rounded-full bg-accent" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium">{info.label}</span>
                        <span className="block text-[13px] text-muted">{info.description}</span>
                      </span>
                      <ProviderMark name={p.name} />
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="text-[13.5px] text-muted underline underline-offset-4 hover:text-red-600"
          >
            Cancel this booking and release the tickets
          </button>
        </div>

        <aside>
          <div className="lg:sticky lg:top-24">
            <OrderSummary
              bookingCode={booking.bookingCode}
              lines={booking.items.map((i) => ({ name: i.name, quantity: i.quantity, amount: i.lineTotal }))}
              subtotal={booking.subtotal}
              discount={booking.discountAmount}
              total={booking.totalAmount}
              currency={booking.currency}
              promoCode={booking.promoCode}
              footer={
                <>
                  <FormAlert message={error} />
                  <Button
                    className={cn("w-full", error && "mt-4")}
                    loading={start.isPending || start.isSuccess}
                    disabled={!chosen}
                    onClick={pay}
                  >
                    {start.isPending || start.isSuccess
                      ? "Taking you to payment…"
                      : `Pay ${formatMoney(booking.totalAmount, booking.currency)}${chosen ? ` with ${PROVIDER_INFO[chosen].label}` : ""}`}
                  </Button>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-muted">
                    <Lock className="size-3" /> Payment is confirmed with the provider, never just from the redirect.
                  </p>
                </>
              }
            />
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this booking?"
        description="Your held tickets go back on sale. You can start a new booking any time while tickets last."
        confirmLabel="Cancel booking"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(booking.id, {
            onSuccess: () => {
              setConfirmCancel(false);
              setBookingId(null);
              toast("Booking cancelled", { description: "The tickets were released." });
            },
            onError: (e) => {
              setConfirmCancel(false);
              toast.error(errorMessage(e));
            },
          })
        }
      />
    </Container>
  );
}

/** Simple text marks; real logos need the providers' brand assets. */
function ProviderMark({ name }: { name: ProviderName }) {
  const style: Record<ProviderName, string> = {
    esewa: "bg-[#60bb46] text-white",
    khalti: "bg-[#5c2d91] text-white",
    stripe: "bg-[#635bff] text-white",
    mock: "bg-ink/[0.06] text-ink/70",
  };
  return (
    <span className={cn("rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-wide", style[name])}>
      {name === "mock" ? "Test" : PROVIDER_INFO[name].label}
    </span>
  );
}

// ───────────── hold expired / cancelled ─────────────

function ExpiredStep({ booking }: { booking: Booking }) {
  const { setBookingId, forgetAttempt } = useCheckoutStore();
  const startAgain = () => {
    forgetAttempt("booking");
    setBookingId(null);
  };
  return (
    <Container className="py-16">
      <EmptyState
        icon={<TimerOff className="size-5" />}
        title={booking.status === "cancelled" ? "This booking was cancelled" : "Your hold expired"}
        description="The tickets were released so others could buy them. Your selection is still saved: start again to book them if they're available."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={startAgain}>Start again</Button>
            <LinkButton href={`/events/${booking.event.slug}`} variant="secondary">
              Back to event
            </LinkButton>
          </div>
        }
      />
    </Container>
  );
}

// ───────────── header ─────────────

function CheckoutHeader({ backHref, backLabel, step }: { backHref: string; backLabel: string; step: 1 | 2 }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink">
          <ArrowLeft className="size-4" /> {backLabel}
        </Link>
        <h1 className="mt-3 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[40px]">Checkout</h1>
      </div>
      <ol className="flex items-center gap-3 text-[13px]" aria-label="Checkout steps">
        {["Review", "Pay", "Tickets"].map((label, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "todo";
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-[12px] font-semibold",
                  state === "current" && "bg-ink text-paper",
                  state === "done" && "bg-accent text-white",
                  state === "todo" && "border border-line text-muted",
                )}
              >
                {n}
              </span>
              <span className={state === "todo" ? "text-muted" : "font-medium"}>{label}</span>
              {n < 3 && <span className="h-px w-6 bg-line" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
