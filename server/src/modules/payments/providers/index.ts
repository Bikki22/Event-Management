import { env } from "../../../config/env.js";
import { AppError, BadRequest } from "../../../lib/errors.js";
import { redis } from "../../../lib/redis.js";
import { esewa } from "./esewa.js";
import { khalti } from "./khalti.js";
import { stripe } from "./stripe.js";
import type { LookupResult, PaymentProvider, ProviderName } from "./types.js";

/**
 * Fake gateway for local development and tests (PAYMENT_MOCK_ENABLED, never in production).
 * POST /payments/mock/complete { paymentId, outcome } plays the part of the buyer paying on the
 * gateway's site; verify/reconcile then "look it up" like with a real provider.
 */
const mockKey = (paymentId: string) => `mock-pay:${paymentId}`;
export const mock: PaymentProvider = {
  name: "mock",
  currencies: ["NPR", "USD"],
  async initiate({ payment, returnUrl }) {
    return {
      action: { type: "redirect", url: `${returnUrl}?provider=mock&paymentId=${payment.id}` },
      providerTxnId: `mock_${payment.id}`,
    };
  },
  parseVerifyInput(body) {
    if (typeof body.paymentId !== "string")
      throw BadRequest("INVALID_PAYMENT_REFERENCE", "paymentId is required");
    return { paymentId: body.paymentId };
  },
  async lookup(payment): Promise<LookupResult> {
    const outcome = await redis.get(mockKey(payment.id));
    if (outcome === "success") {
      return {
        status: "succeeded",
        amount: payment.amount,
        currency: payment.currency,
        providerRef: `mock_txn_${payment.id}`,
        raw: { outcome },
      };
    }
    if (outcome === "failure")
      return { status: "failed", failureReason: "Declined (mock)", raw: { outcome } };
    return { status: "pending", raw: { outcome: null } };
  },
  async refund(payment) {
    return { status: "succeeded", providerRefundId: `mock_rf_${payment.id}` };
  },
};
export const setMockOutcome = (paymentId: string, outcome: "success" | "failure") =>
  redis.set(mockKey(paymentId), outcome, "EX", 86_400);

/** Providers switched on by configuration. */
export function enabledProviders(): PaymentProvider[] {
  const list: PaymentProvider[] = [];
  if (env.KHALTI_SECRET_KEY) list.push(khalti);
  if (env.ESEWA_PRODUCT_CODE && env.ESEWA_SECRET_KEY) list.push(esewa);
  if (env.STRIPE_SECRET_KEY) list.push(stripe);
  if (env.PAYMENT_MOCK_ENABLED) list.push(mock);
  return list;
}

export function getProvider(name: string): PaymentProvider {
  const p = enabledProviders().find((x) => x.name === name);
  if (!p)
    throw new AppError(
      404,
      "PROVIDER_NOT_AVAILABLE",
      `Payment provider '${name}' is not available`,
    );
  return p;
}

/** For refunds/reconcile of an existing payment, even if the provider was later switched off. */
export function providerFor(name: ProviderName | "free"): PaymentProvider | null {
  return ({ khalti, esewa, stripe, mock } as Record<string, PaymentProvider>)[name] ?? null;
}
