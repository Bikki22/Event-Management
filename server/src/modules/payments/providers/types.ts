import type { Booking, Event, Payment, User } from "../../../generated/prisma/client.js";

export type ProviderName = "khalti" | "esewa" | "stripe" | "mock";

/** What the frontend must do to send the buyer to the gateway. */
export type CheckoutAction =
  | { type: "redirect"; url: string }
  | { type: "form"; method: "POST"; url: string; fields: Record<string, string> };

export interface InitiateInput {
  payment: Payment;
  booking: Booking;
  event: Event;
  user: User;
  returnUrl: string; // our frontend page; providers add their own query params
}

export interface InitiateResult {
  action: CheckoutAction;
  providerTxnId?: string; // e.g. Khalti pidx, Stripe session id
  raw?: unknown;
}

/**
 * The gateway's server-side answer. Only this is trusted, never redirect parameters.
 * `amount` is in minor units (paisa).
 */
export interface LookupResult {
  status: "succeeded" | "pending" | "failed" | "refunded";
  amount?: bigint;
  currency?: string;
  providerTxnId?: string;
  providerRef?: string;
  failureReason?: string;
  raw: unknown;
}

export interface RefundResult {
  /** "manual": the gateway has no refund API; an admin settles it and marks it done. */
  status: "succeeded" | "manual";
  providerRefundId?: string;
  raw?: unknown;
}

/** How a verify call identifies the payment (what the gateway put on the return URL). */
export type VerifyRef = { paymentId: string } | { providerTxnId: string };

export interface PaymentProvider {
  name: ProviderName;
  currencies: string[];
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Parses (and for eSewa, signature-checks) what the frontend got back from the gateway. */
  parseVerifyInput(body: Record<string, unknown>): VerifyRef;
  lookup(payment: Payment): Promise<LookupResult>;
  refund(payment: Payment, amount: bigint, idempotencyKey: string): Promise<RefundResult>;
}
