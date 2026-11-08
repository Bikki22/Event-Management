"use client";

import { ArrowLeft, ChevronRight, Ticket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { EventStrip, OrderSummary } from "@/components/checkout/parts";
import { Button, LinkButton } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Textarea } from "@/components/ui/inputs";
import { Badge, EmptyState, PageLoader, Section } from "@/components/ui/primitives";
import { useBooking, useCancelBooking } from "@/hooks/use-checkout";
import { useRequestRefund } from "@/hooks/use-my-tickets";
import { useNow } from "@/hooks/use-now";
import { BOOKING_STATUS, REFUND_CUTOFF_HOURS, type Booking } from "@/lib/api/bookings";
import { ApiError, errorMessage } from "@/lib/api/client";
import { TICKET_STATUS, type TicketStatus } from "@/lib/api/tickets";
import { formatDate, formatEventDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCheckoutStore } from "@/stores/checkout-store";

export function BookingDetail({ id }: { id: string }) {
  const booking = useBooking(id);
  if (booking.isPending) return <PageLoader />;
  if (booking.isError) {
    return (
      <EmptyState
        title="We couldn't open this booking"
        description={errorMessage(booking.error)}
        action={<LinkButton href="/account/bookings">Back to my bookings</LinkButton>}
      />
    );
  }
  return <BookingView b={booking.data} />;
}

const REFUND_STATUS: Record<string, string> = {
  requested: "Refund requested",
  processing: "Refund in progress",
  succeeded: "Refunded",
  failed: "Refund failed: our team will retry it",
};

function BookingView({ b }: { b: Booking }) {
  const router = useRouter();
  const now = useNow();
  const cancel = useCancelBooking();
  const [refundOpen, setRefundOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const status = BOOKING_STATUS[b.status];
  const free = b.totalAmount === 0;

  const startsAt = new Date(b.event.startsAt).getTime();
  const windowOpen = now !== null && now < startsAt - REFUND_CUTOFF_HOURS * 3_600_000;
  const anyUsed = b.tickets.some((t) => t.status === "checked_in");
  const canRefund = b.status === "confirmed" && !b.refund && windowOpen && !anyUsed;

  /** Back to checkout's payment step with this booking. */
  const resumePayment = () => {
    const store = useCheckoutStore.getState();
    store.start({
      eventId: b.event.id,
      eventSlug: b.event.slug,
      eventTitle: b.event.title,
      currency: b.currency,
      lines: b.items.map((i) => ({ ticketTypeId: i.ticketTypeId, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity })),
    });
    store.setBookingId(b.id);
    router.push(`/checkout/${b.event.id}`);
  };

  return (
    <div>
      <Link href="/account/bookings" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> My bookings
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-semibold tracking-[-0.035em] sm:text-[32px]">Booking {b.bookingCode}</h1>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="mt-1 text-[14px] text-muted">Booked {formatDate(b.createdAt)}</p>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Link href={`/events/${b.event.slug}`} className="block rounded-2xl transition hover:opacity-90">
            <EventStrip
              title={b.event.title}
              startsAt={b.event.startsAt}
              endsAt={b.event.endsAt}
              timezone={b.event.timezone}
              cover={b.event.coverImage}
            />
          </Link>

          {b.status === "pending" && (
            <FormAlert
              tone="error"
              message={`This booking isn't paid yet. Your tickets are held until ${
                b.expiresAt ? new Date(b.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon"
              }; after that they're released.`}
            />
          )}

          {b.refund && (
            <Section title="Refund">
              <dl className="-my-2 grid gap-3 text-[14.5px] sm:grid-cols-2">
                <Fact label="Status">{REFUND_STATUS[b.refund.status] ?? b.refund.status}</Fact>
                <Fact label="Amount">{b.refund.amount === 0 ? "Nothing to refund (free)" : formatMoney(b.refund.amount, b.currency)}</Fact>
                <Fact label="Reason">{b.refund.reason}</Fact>
                {b.refund.completedAt && <Fact label="Completed">{formatDate(b.refund.completedAt)}</Fact>}
              </dl>
              {b.refund.manual && b.refund.status !== "succeeded" && (
                <p className="mt-4 text-[13.5px] text-muted">
                  This payment method has no automatic refunds, so our team sends the money back by hand. It usually takes 1–3 working days.
                </p>
              )}
            </Section>
          )}

          {b.tickets.length > 0 && (
            <Section title={`Tickets (${b.tickets.length})`}>
              <ul className="-my-3 divide-y divide-line">
                {b.tickets.map((t) => {
                  const s = TICKET_STATUS[t.status as TicketStatus] ?? { label: t.status, tone: "neutral" as const };
                  return (
                    <li key={t.id}>
                      <Link href={`/account/tickets/${t.id}`} className="group flex items-center gap-3 py-3">
                        <Ticket className="size-4 text-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-medium">{t.ticketType}</span>
                          <span className="block font-mono text-[12px] text-muted">
                            {t.ticketCode}
                            {t.holderName ? ` · ${t.holderName}` : ""}
                          </span>
                        </span>
                        <Badge tone={s.tone}>{s.label}</Badge>
                        <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {b.contact && (
            <Section title="Contact">
              <dl className="-my-2 grid gap-3 text-[14.5px] sm:grid-cols-2">
                <Fact label="Email">{b.contact.email}</Fact>
                <Fact label="Phone">{b.contact.phone ?? "Not given"}</Fact>
              </dl>
            </Section>
          )}
        </div>

        <aside className="space-y-4">
          <OrderSummary
            bookingCode={b.bookingCode}
            lines={b.items.map((i) => ({ name: i.name, quantity: i.quantity, amount: i.lineTotal }))}
            subtotal={b.subtotal}
            discount={b.discountAmount}
            total={b.totalAmount}
            currency={b.currency}
            promoCode={b.promoCode}
            footer={
              b.status === "pending" ? (
                <div className="space-y-2">
                  <Button className="w-full" onClick={resumePayment}>
                    Complete payment
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => setCancelOpen(true)}>
                    Cancel booking
                  </Button>
                </div>
              ) : b.status === "confirmed" && !b.refund ? (
                canRefund ? (
                  <Button variant="secondary" className="w-full" onClick={() => setRefundOpen(true)}>
                    {free ? "Cancel booking" : "Cancel and refund"}
                  </Button>
                ) : (
                  <p className="text-[13px] leading-relaxed text-muted">
                    {anyUsed
                      ? "A ticket from this booking was already used, so it can't be refunded."
                      : `Refunds close ${REFUND_CUTOFF_HOURS} hours before the event starts. Contact the organizer if you need help.`}
                  </p>
                )
              ) : undefined
            }
          />
          {b.status === "confirmed" && !b.refund && canRefund && !free && (
            <p className="px-1 text-[12.5px] text-muted">
              You can get a full refund until {REFUND_CUTOFF_HOURS} hours before the event (
              {formatEventDate(new Date(startsAt - REFUND_CUTOFF_HOURS * 3_600_000).toISOString(), null, b.event.timezone)}).
            </p>
          )}
        </aside>
      </div>

      <RefundDialog booking={b} open={refundOpen} onClose={() => setRefundOpen(false)} />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this booking?"
        description="Your held tickets go back on sale."
        confirmLabel="Cancel booking"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(b.id, {
            onSuccess: () => {
              setCancelOpen(false);
              toast("Booking cancelled");
            },
            onError: (e) => {
              setCancelOpen(false);
              toast.error(errorMessage(e));
            },
          })
        }
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

const REASONS = ["Can't make it anymore", "Booked by mistake", "The event changed", "Other"];

function RefundDialog({ booking, open, onClose }: { booking: Booking; open: boolean; onClose: () => void }) {
  const refund = useRequestRefund(booking.id);
  const [choice, setChoice] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  // one key per dialog session: a double click or retry can't request two refunds
  const [key, setKey] = useState(() => crypto.randomUUID());
  const free = booking.totalAmount === 0;

  const close = () => {
    setError(null);
    setKey(crypto.randomUUID());
    onClose();
  };

  const submit = () => {
    const reason = choice === "Other" ? details.trim() : [choice, details.trim()].filter(Boolean).join(": ");
    if (reason.length < 3) return setError("Tell us briefly why you're cancelling");
    setError(null);
    refund.mutate(
      { reason: reason.slice(0, 500), key },
      {
        onSuccess: () => {
          toast.success(free ? "Booking cancelled" : "Refund requested", {
            description: free ? "Your tickets were released." : "The money goes back to your original payment method.",
          });
          close();
        },
        onError: (err) => {
          if (err instanceof ApiError && ["REFUND_WINDOW_CLOSED", "TICKETS_ALREADY_USED", "BOOKING_NOT_REFUNDABLE"].includes(err.code)) {
            setError(err.message);
          } else setError(errorMessage(err));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={free ? "Cancel this booking?" : "Cancel and get a refund?"}
      description={
        free
          ? "Your tickets will be cancelled and released for others."
          : `All ${booking.tickets.length} ticket(s) will be cancelled and ${formatMoney(booking.totalAmount, booking.currency)} refunded to your original payment method.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={refund.isPending}>
            Keep my tickets
          </Button>
          <Button onClick={submit} loading={refund.isPending} className="bg-red-600 hover:bg-red-700">
            {free ? "Cancel booking" : "Cancel and refund"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormAlert message={error} />
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Reason</legend>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={choice === r}
                onClick={() => setChoice(r)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[13px] transition",
                  choice === r ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/30",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </fieldset>
        <Textarea
          label={choice === "Other" ? "Tell us more" : "Anything else?"}
          labelAside={choice === "Other" ? undefined : <span className="text-[12px] text-muted">Optional</span>}
          rows={3}
          maxLength={400}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
