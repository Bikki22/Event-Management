import { createHmac } from "node:crypto";
import { env } from "../../../config/env.js";
import { safeEqual } from "../../../lib/crypto.js";
import { BadRequest } from "../../../lib/errors.js";
import { requestJson } from "../../../lib/http.js";
import type { LookupResult, PaymentProvider } from "./types.js";

/**
 * Stripe Checkout (hosted page), called over the REST API with fetch.
 *   initiate: POST /v1/checkout/sessions → { id, url }
 *   lookup:   GET  /v1/checkout/sessions/{id} → { payment_status: paid | unpaid, status, amount_total, currency, payment_intent }
 *   refund:   POST /v1/refunds (Idempotency-Key = our refund id)
 *   webhooks: Stripe-Signature: t=…,v1=HMAC-SHA256(secret, "t.rawBody")
 */
const api = (path: string) => `${env.STRIPE_API_BASE.replace(/\/+$/, "")}${path}`;
const auth = () => ({ Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` });

interface StripeSession {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null;
  client_reference_id: string | null;
}

export const stripe: PaymentProvider = {
  name: "stripe",
  currencies: ["NPR", "USD", "EUR", "GBP", "INR"],

  async initiate({ payment, event, user, returnUrl }) {
    const form = new URLSearchParams({
      mode: "payment",
      client_reference_id: payment.id,
      customer_email: user.email,
      success_url: `${returnUrl}?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}?provider=stripe&cancelled=1&paymentId=${payment.id}`,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": payment.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": payment.amount.toString(),
      "line_items[0][price_data][product_data][name]": event.title.slice(0, 250),
      "metadata[payment_id]": payment.id,
      "payment_intent_data[metadata][payment_id]": payment.id,
      // the booking hold is short; don't let a checkout page outlive it by much
      expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
    });
    const { data } = await requestJson<StripeSession>("stripe", api("/v1/checkout/sessions"), {
      method: "POST",
      headers: {
        ...auth(),
        "content-type": "application/x-www-form-urlencoded",
        "Idempotency-Key": payment.id,
      },
      body: form,
    });
    return { action: { type: "redirect", url: data.url! }, providerTxnId: data.id, raw: data };
  },

  parseVerifyInput(body) {
    const id = body.sessionId;
    if (typeof id !== "string" || !/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) {
      throw BadRequest("INVALID_PAYMENT_REFERENCE", "sessionId (cs_…) is required");
    }
    return { providerTxnId: id };
  },

  async lookup(payment): Promise<LookupResult> {
    const { data } = await requestJson<StripeSession>(
      "stripe",
      api(`/v1/checkout/sessions/${encodeURIComponent(payment.providerTxnId!)}`),
      { headers: auth(), retries: 2 },
    );
    const common = {
      amount: data.amount_total !== null ? BigInt(data.amount_total) : undefined,
      currency: data.currency?.toUpperCase(),
      providerTxnId: data.id,
      providerRef: data.payment_intent ?? undefined,
      raw: data,
    };
    if (data.payment_status === "paid") return { status: "succeeded", ...common };
    if (data.status === "expired")
      return { status: "failed", failureReason: "Checkout session expired", ...common };
    return { status: "pending", ...common };
  },

  async refund(payment, amount, idempotencyKey) {
    const { data } = await requestJson<{ id: string; status: string }>(
      "stripe",
      api("/v1/refunds"),
      {
        method: "POST",
        headers: {
          ...auth(),
          "content-type": "application/x-www-form-urlencoded",
          "Idempotency-Key": idempotencyKey,
        },
        body: new URLSearchParams({
          payment_intent: payment.providerRef!,
          amount: amount.toString(),
        }),
      },
    );
    return { status: "succeeded", providerRefundId: data.id, raw: data };
  },
};

/** Verifies a Stripe webhook signature (5-minute tolerance against replays). */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: string | undefined,
  now = Date.now(),
): boolean {
  if (!header || !env.STRIPE_WEBHOOK_SECRET) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0 || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET)
    .update(`${t}.${rawBody.toString("utf8")}`)
    .digest("hex");
  return sigs.some((s) => safeEqual(s, expected));
}
