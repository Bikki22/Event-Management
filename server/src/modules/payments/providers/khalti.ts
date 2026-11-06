import { env } from "../../../config/env.js";
import { BadRequest } from "../../../lib/errors.js";
import { requestJson } from "../../../lib/http.js";
import type { LookupResult, PaymentProvider } from "./types.js";

/**
 * Khalti ePayment (KPG-2). Amounts are in paisa.
 *   initiate: POST {base}/epayment/initiate/  → { pidx, payment_url }
 *   lookup:   POST {base}/epayment/lookup/    → { status: Completed | Pending | Initiated | Expired | User canceled | Refunded | Partially Refunded, total_amount, transaction_id }
 *   refund:   POST {origin}/api/merchant-transaction/{transaction_id}/refund/
 */
const base = () => env.KHALTI_BASE_URL.replace(/\/+$/, "");
const headers = () => ({
  Authorization: `Key ${env.KHALTI_SECRET_KEY}`,
  "content-type": "application/json",
});

interface KhaltiLookup {
  pidx: string;
  total_amount: number;
  status: string;
  transaction_id: string | null;
  refunded?: boolean;
}

export const khalti: PaymentProvider = {
  name: "khalti",
  currencies: ["NPR"],

  async initiate({ payment, event, user, returnUrl }) {
    const { data } = await requestJson<{ pidx: string; payment_url: string }>(
      "khalti",
      `${base()}/epayment/initiate/`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          return_url: `${returnUrl}?provider=khalti`,
          website_url: env.FRONTEND_URL,
          amount: Number(payment.amount),
          purchase_order_id: payment.id,
          purchase_order_name: event.title.slice(0, 100),
          customer_info: {
            name: user.fullName,
            email: user.email,
            ...(user.phone ? { phone: user.phone } : {}),
          },
        }),
      },
    );
    return {
      action: { type: "redirect", url: data.payment_url },
      providerTxnId: data.pidx,
      raw: data,
    };
  },

  // Khalti redirects to return_url?pidx=…&status=…; only pidx is used, the rest is untrusted
  parseVerifyInput(body) {
    const pidx = body.pidx;
    if (typeof pidx !== "string" || !/^[A-Za-z0-9]{10,64}$/.test(pidx)) {
      throw BadRequest("INVALID_PAYMENT_REFERENCE", "pidx is required");
    }
    return { providerTxnId: pidx };
  },

  async lookup(payment): Promise<LookupResult> {
    const { data } = await requestJson<KhaltiLookup>("khalti", `${base()}/epayment/lookup/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ pidx: payment.providerTxnId }),
      retries: 2, // lookups are safe to retry
      acceptStatus: [400, 404], // unknown/expired pidx → treated below
    });
    const status = data?.status;
    const common = {
      amount: data?.total_amount !== undefined ? BigInt(data.total_amount) : undefined,
      currency: "NPR",
      providerTxnId: data?.pidx,
      providerRef: data?.transaction_id ?? undefined,
      raw: data,
    };
    switch (status) {
      case "Completed":
        return { status: "succeeded", ...common };
      case "Pending":
      case "Initiated":
        return { status: "pending", ...common };
      case "Refunded":
      case "Partially Refunded":
        return { status: "refunded", ...common };
      default:
        return {
          status: "failed",
          failureReason: `Khalti status: ${status ?? "not found"}`,
          ...common,
        };
    }
  },

  async refund(payment, amount, _idempotencyKey) {
    if (!payment.providerRef) throw new Error("Khalti refund needs the transaction_id");
    const origin = new URL(base()).origin;
    const { data } = await requestJson<{ detail?: string }>(
      "khalti",
      `${origin}/api/merchant-transaction/${encodeURIComponent(payment.providerRef)}/refund/`,
      {
        method: "POST",
        headers: headers(),
        // amount omitted = full refund; partial refunds send the amount
        body: JSON.stringify(amount < payment.amount ? { amount: Number(amount) } : {}),
      },
    );
    return { status: "succeeded", providerRefundId: payment.providerRef, raw: data };
  },
};
