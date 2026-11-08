"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleX, FlaskConical, LoaderCircle, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Container } from "@/components/layout/page-header";
import { Button, LinkButton } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { useBooking } from "@/hooks/use-checkout";
import { paymentsApi, type ProviderName, type VerifyResult } from "@/lib/api/bookings";
import { ApiError, errorMessage } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { hydrateCheckout, useCheckoutStore } from "@/stores/checkout-store";
import { BookingConfirmed } from "./parts";

const PROVIDERS: ProviderName[] = ["khalti", "esewa", "stripe", "mock"];

/**
 * Turns the gateway's redirect into the verify body the API expects. Only the reference is
 * used; status flags in the URL are untrusted and just decide whether to call verify at all.
 */
function readReturn(params: URLSearchParams) {
  const provider = params.get("provider") as ProviderName | null;
  if (!provider || !PROVIDERS.includes(provider)) return { kind: "invalid" as const };
  if (params.get("cancelled") === "1" || params.get("failed") === "1") return { kind: "abandoned" as const, provider };

  const body: Record<string, string> | null =
    provider === "khalti" && params.get("pidx")
      ? { pidx: params.get("pidx")! }
      : provider === "esewa" && params.get("data")
        ? { data: params.get("data")! }
        : provider === "stripe" && params.get("session_id")
          ? { sessionId: params.get("session_id")! }
          : provider === "mock" && params.get("paymentId")
            ? { paymentId: params.get("paymentId")! }
            : null;
  return body ? { kind: "verify" as const, provider, body } : { kind: "invalid" as const };
}

export function PaymentReturn() {
  const params = useSearchParams();
  const ret = useMemo(() => readReturn(new URLSearchParams(params.toString())), [params]);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    void hydrateCheckout().then(() => setHydrated(true));
  }, []);
  const { eventId, bookingId } = useCheckoutStore();
  const retryHref = hydrated && eventId ? `/checkout/${eventId}` : "/account/bookings";

  // a query (not an effect) so verify runs once even with StrictMode; the server makes it idempotent anyway
  const verify = useQuery({
    queryKey: ["payment-verify", ret.kind === "verify" ? ret.provider : "", ret.kind === "verify" ? ret.body : null],
    queryFn: () => (ret.kind === "verify" ? paymentsApi.verify(ret.provider, ret.body) : Promise.reject()),
    enabled: ret.kind === "verify",
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (ret.kind === "invalid") {
    return (
      <Shell>
        <StatusIcon tone="warn" />
        <Title>We couldn&apos;t read that payment</Title>
        <Body>The link from the payment provider is incomplete. If you paid, your booking is confirmed automatically within a few minutes.</Body>
        <Actions>
          <LinkButton href="/account/bookings">My bookings</LinkButton>
        </Actions>
      </Shell>
    );
  }

  if (ret.kind === "abandoned") {
    return (
      <Shell>
        <StatusIcon tone="fail" />
        <Title>Payment cancelled</Title>
        <Body>No money was taken. Your tickets may still be held for a few minutes: you can try again or pick another payment method.</Body>
        <Actions>
          <LinkButton href={retryHref}>Try again</LinkButton>
        </Actions>
      </Shell>
    );
  }

  if (verify.isPending) return <Verifying />;

  if (verify.isError) {
    const unavailable = verify.error instanceof ApiError && verify.error.code === "PAYMENT_PROVIDER_UNAVAILABLE";
    if (unavailable && bookingId) return <WaitForBooking bookingId={bookingId} message={errorMessage(verify.error)} />;
    return (
      <Shell>
        <StatusIcon tone="warn" />
        <Title>We couldn&apos;t confirm the payment yet</Title>
        <Body>{errorMessage(verify.error)}</Body>
        <Actions>
          <Button onClick={() => verify.refetch()}>
            <RefreshCw className="size-4" /> Check again
          </Button>
          <LinkButton href="/account/bookings" variant="secondary">
            My bookings
          </LinkButton>
        </Actions>
      </Shell>
    );
  }

  return <Outcome result={verify.data} provider={ret.provider} retryHref={retryHref} onRecheck={() => verify.refetch()} />;
}

function Outcome({
  result,
  provider,
  retryHref,
  onRecheck,
}: {
  result: VerifyResult;
  provider: ProviderName;
  retryHref: string;
  onRecheck: () => void;
}) {
  const { booking, payment, outcome } = result;

  switch (outcome) {
    case "confirmed":
    case "already_succeeded":
      return (
        <Container className="py-12 sm:py-16">
          <BookingConfirmed booking={booking} />
        </Container>
      );
    case "duplicate":
      return (
        <Container className="py-12 sm:py-16">
          <BookingConfirmed
            booking={booking}
            note={<FormAlert tone="success" message="This booking was already paid, so this second payment will be refunded to you." />}
          />
        </Container>
      );
    case "pending":
      // the fake gateway hasn't been "paid" yet: show it. Real gateways: wait for them.
      if (provider === "mock") return <MockGateway paymentId={payment.id} amount={payment.amount} currency={payment.currency} onDone={onRecheck} />;
      return <WaitForBooking bookingId={booking.id} message="The payment provider is still processing your payment." />;
    case "failed":
      return (
        <Shell>
          <StatusIcon tone="fail" />
          <Title>Payment didn&apos;t go through</Title>
          <Body>{payment.failureReason ? `${payment.failureReason}. ` : ""}No money was taken. You can try again while your tickets are held.</Body>
          <Actions>
            <LinkButton href={retryHref}>Try again</LinkButton>
          </Actions>
        </Shell>
      );
    case "needs_refund":
      return (
        <Shell>
          <StatusIcon tone="warn" />
          <Title>The tickets sold out while you paid</Title>
          <Body>
            Your hold had expired and the last tickets went to someone else. We&apos;ve started a full refund of{" "}
            {formatMoney(payment.amount, payment.currency)}; it&apos;s on its way back to you.
          </Body>
          <Actions>
            <LinkButton href={`/events/${booking.event.slug}`}>Back to event</LinkButton>
          </Actions>
        </Shell>
      );
    case "amount_mismatch":
      return (
        <Shell>
          <StatusIcon tone="fail" />
          <Title>We couldn&apos;t confirm this payment</Title>
          <Body>The amount reported by the provider didn&apos;t match your order, so we didn&apos;t confirm it. Please contact support with booking {booking.bookingCode}.</Body>
          <Actions>
            <LinkButton href="/account/bookings">My bookings</LinkButton>
          </Actions>
        </Shell>
      );
  }
}

/** Dev-only stand-in for a real payment page (provider "mock"). */
function MockGateway({ paymentId, amount, currency, onDone }: { paymentId: string; amount: number; currency: string; onDone: () => void }) {
  const complete = useMutation({
    mutationFn: (outcome: "success" | "failure") => paymentsApi.mockComplete(paymentId, outcome),
    onSuccess: onDone,
  });
  return (
    <Shell>
      <div className="rounded-2xl border border-dashed border-ink/25 bg-card p-6">
        <p className="flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted">
          <FlaskConical className="size-4 text-accent" /> Test payment gateway
        </p>
        <p className="mt-4 text-[15px] text-muted">Amount</p>
        <p className="text-[32px] font-semibold tracking-[-0.04em]">{formatMoney(amount, currency)}</p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
          This screen only exists in development (PAYMENT_MOCK_ENABLED). No real money moves. Choose what the
          &quot;bank&quot; answers:
        </p>
        <FormAlert message={complete.isError ? errorMessage(complete.error) : null} />
        <div className="mt-5 flex flex-wrap gap-2">
          <Button loading={complete.isPending && complete.variables === "success"} disabled={complete.isPending} onClick={() => complete.mutate("success")}>
            Approve payment
          </Button>
          <Button
            variant="secondary"
            loading={complete.isPending && complete.variables === "failure"}
            disabled={complete.isPending}
            onClick={() => complete.mutate("failure")}
          >
            Decline
          </Button>
        </div>
      </div>
    </Shell>
  );
}

/** Polls the booking while a gateway is slow; confirms as soon as the server does. */
function WaitForBooking({ bookingId, message }: { bookingId: string; message: string }) {
  const booking = useBooking(bookingId);
  const [tries, setTries] = useState(0);
  const { refetch } = booking;
  const done = booking.data && booking.data.status !== "pending";

  useEffect(() => {
    if (done || tries >= 20) return;
    const t = window.setTimeout(() => {
      void refetch();
      setTries((n) => n + 1);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [done, tries, refetch]);

  if (booking.data?.status === "confirmed") {
    return (
      <Container className="py-12 sm:py-16">
        <BookingConfirmed booking={booking.data} />
      </Container>
    );
  }

  return (
    <Shell>
      <StatusIcon tone="wait" />
      <Title>Confirming your payment…</Title>
      <Body>
        {message} You can leave this page: if the payment went through, your booking is confirmed automatically and we&apos;ll email
        your tickets.
      </Body>
      <Actions>
        <LinkButton href="/account/bookings" variant="secondary">
          My bookings
        </LinkButton>
      </Actions>
    </Shell>
  );
}

function Verifying() {
  return (
    <Shell>
      <StatusIcon tone="wait" />
      <Title>Confirming your payment…</Title>
      <Body>We&apos;re checking with the payment provider. This usually takes a few seconds; please don&apos;t close this page.</Body>
    </Shell>
  );
}

// ───────────── layout bits ─────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto max-w-xl">{children}</div>
    </Container>
  );
}

function StatusIcon({ tone }: { tone: "wait" | "fail" | "warn" }) {
  const Icon = tone === "wait" ? LoaderCircle : tone === "fail" ? CircleX : CircleAlert;
  return (
    <div className="mb-6 grid size-12 place-items-center rounded-full border border-line bg-card">
      <Icon className={tone === "wait" ? "size-5 animate-spin text-ink" : tone === "fail" ? "size-5 text-red-600" : "size-5 text-accent"} />
    </div>
  );
}

const Title = ({ children }: { children: React.ReactNode }) => (
  <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em]">{children}</h1>
);
const Body = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{children}</p>;
const Actions = ({ children }: { children: React.ReactNode }) => <div className="mt-8 flex flex-wrap gap-3">{children}</div>;
