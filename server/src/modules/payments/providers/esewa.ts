import { createHmac } from "node:crypto";
import { env } from "../../../config/env.js";
import { safeEqual } from "../../../lib/crypto.js";
import { BadRequest } from "../../../lib/errors.js";
import { requestJson } from "../../../lib/http.js";
import type { LookupResult, PaymentProvider } from "./types.js";

/**
 * eSewa ePay v2. Amounts are in rupees (we store paisa).
 *   initiate: the browser POSTs a signed HTML form to ESEWA_FORM_URL
 *   return:   success_url?data=<base64 JSON with its own signature>
 *   status:   GET ESEWA_STATUS_URL?product_code&total_amount&transaction_uuid
 *             → { status: COMPLETE | PENDING | FULL_REFUND | PARTIAL_REFUND | AMBIGUOUS | NOT_FOUND | CANCELED, ref_id }
 * eSewa has no refund API: refunds are settled in the merchant portal (marked "manual").
 */

/** 150000 paisa → "1500"; 150050 → "1500.50". The exact string is part of the signature. */
export const toRupees = (paisa: bigint) =>
  paisa % 100n === 0n ? (paisa / 100n).toString() : (Number(paisa) / 100).toFixed(2);
const toPaisa = (rupees: string | number) =>
  BigInt(Math.round(Number(String(rupees).replace(/,/g, "")) * 100));

/** base64(HMAC-SHA256(secret, "k1=v1,k2=v2,…")) over the signed field names, in order. */
export function esewaSignature(fields: Record<string, string>, signedFieldNames: string): string {
  const message = signedFieldNames
    .split(",")
    .map((k) => `${k}=${fields[k] ?? ""}`)
    .join(",");
  return createHmac("sha256", env.ESEWA_SECRET_KEY!).update(message).digest("base64");
}

interface EsewaStatus {
  product_code: string;
  transaction_uuid: string;
  total_amount: number | string;
  status: string;
  ref_id: string | null;
}

export const esewa: PaymentProvider = {
  name: "esewa",
  currencies: ["NPR"],

  async initiate({ payment, returnUrl }) {
    const total = toRupees(payment.amount);
    const fields: Record<string, string> = {
      amount: total,
      tax_amount: "0",
      total_amount: total,
      transaction_uuid: payment.id,
      product_code: env.ESEWA_PRODUCT_CODE!,
      product_service_charge: "0",
      product_delivery_charge: "0",
      success_url: `${returnUrl}?provider=esewa`,
      failure_url: `${returnUrl}?provider=esewa&failed=1&paymentId=${payment.id}`,
      signed_field_names: "total_amount,transaction_uuid,product_code",
    };
    fields.signature = esewaSignature(fields, fields.signed_field_names!);
    return { action: { type: "form", method: "POST", url: env.ESEWA_FORM_URL, fields } };
  },

  /**
   * The frontend forwards `data` from the success redirect. We check its signature (cheap
   * tamper check) but still confirm with the status API before trusting anything.
   */
  parseVerifyInput(body) {
    if (typeof body.data !== "string" || body.data.length > 4000) {
      throw BadRequest("INVALID_PAYMENT_REFERENCE", "data (from the eSewa redirect) is required");
    }
    let decoded: Record<string, string>;
    try {
      decoded = JSON.parse(Buffer.from(body.data, "base64").toString("utf8")) as Record<
        string,
        string
      >;
    } catch {
      throw BadRequest("INVALID_PAYMENT_REFERENCE", "data is not valid base64 JSON");
    }
    const names = decoded.signed_field_names;
    const expected = names ? esewaSignature(decoded, names) : "";
    if (!names || !decoded.signature || !safeEqual(expected, decoded.signature)) {
      throw BadRequest("INVALID_SIGNATURE", "eSewa response signature doesn't match");
    }
    if (!decoded.transaction_uuid)
      throw BadRequest("INVALID_PAYMENT_REFERENCE", "transaction_uuid missing");
    return { paymentId: decoded.transaction_uuid };
  },

  async lookup(payment): Promise<LookupResult> {
    const url = new URL(env.ESEWA_STATUS_URL);
    url.searchParams.set("product_code", env.ESEWA_PRODUCT_CODE!);
    url.searchParams.set("total_amount", toRupees(payment.amount));
    url.searchParams.set("transaction_uuid", payment.id);
    const { data } = await requestJson<EsewaStatus>("esewa", url.toString(), {
      retries: 2,
      acceptStatus: [400, 404],
    });
    const common = {
      amount: data?.total_amount !== undefined ? toPaisa(data.total_amount) : undefined,
      currency: "NPR",
      providerRef: data?.ref_id ?? undefined,
      providerTxnId: data?.ref_id ?? undefined,
      raw: data,
    };
    switch (data?.status) {
      case "COMPLETE":
        return { status: "succeeded", ...common };
      case "PENDING":
      case "AMBIGUOUS":
        return { status: "pending", ...common };
      case "FULL_REFUND":
      case "PARTIAL_REFUND":
        return { status: "refunded", ...common };
      default:
        return {
          status: "failed",
          failureReason: `eSewa status: ${data?.status ?? "unknown"}`,
          ...common,
        };
    }
  },

  async refund() {
    return { status: "manual" };
  },
};
