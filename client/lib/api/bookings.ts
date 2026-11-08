import { api, qs } from "./client";
import type { ImageVariants } from "./events";
import type { Page } from "./pagination";

// Shapes mirror server/src/modules/bookings/bookings.dto.ts and payments.service.ts. Money in paisa.

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired" | "refunded" | "partially_refunded";

export interface BookingItemInput {
  ticketTypeId: string;
  quantity: number;
}

export interface Booking {
  id: string;
  bookingCode: string;
  status: BookingStatus;
  event: {
    id: string;
    slug: string;
    title: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    coverImage: ImageVariants | null;
  };
  items: { ticketTypeId: string; name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discountAmount: number;
  feeAmount: number;
  totalAmount: number;
  currency: string;
  /** pending only: pay before this or the hold is released */
  expiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  promoCode: string | null;
  refund: { id: string; status: string; amount: number; reason: string; manual: boolean; completedAt: string | null } | null;
  tickets: { id: string; ticketCode: string; ticketType: string; status: string; holderName: string | null }[];
  contact?: { email: string; phone: string | null };
}

export interface CreateBookingInput {
  eventId: string;
  items: BookingItemInput[];
  contactPhone?: string;
  promoCode?: string;
}

export interface PromoPreview {
  valid: true;
  discountType: "percent" | "fixed";
  discountValue: number;
  preview: { subtotal: number; discountAmount: number; total: number };
}

export type ProviderName = "khalti" | "esewa" | "stripe" | "mock";

export interface Payment {
  id: string;
  bookingId: string;
  provider: ProviderName;
  amount: number;
  currency: string;
  status: "initiated" | "pending" | "succeeded" | "failed" | "cancelled" | "refunded";
  failureReason: string | null;
  initiatedAt: string;
  completedAt: string | null;
}

/** What the browser must do to reach the gateway. */
export type CheckoutAction =
  | { type: "redirect"; url: string }
  | { type: "form"; method: "POST"; url: string; fields: Record<string, string> };

export type VerifyOutcome =
  | "confirmed"
  | "already_succeeded"
  | "pending"
  | "failed"
  | "amount_mismatch"
  | "duplicate"
  | "needs_refund";

export interface VerifyResult {
  outcome: VerifyOutcome;
  payment: Payment;
  booking: Booking;
}

const idem = (key: string) => ({ "Idempotency-Key": key });

export const bookingsApi = {
  create: (body: CreateBookingInput, idempotencyKey: string) =>
    api<{ booking: Booking }>("/bookings", { method: "POST", body, headers: idem(idempotencyKey) }),

  get: (id: string) => api<{ booking: Booking }>(`/bookings/${encodeURIComponent(id)}`),

  cancel: (id: string) => api<{ booking: Booking }>(`/bookings/${encodeURIComponent(id)}/cancel`, { method: "POST" }),

  validatePromo: (body: { eventId: string; code: string; items: BookingItemInput[] }) =>
    api<PromoPreview>("/promo-codes/validate", { method: "POST", body }),

  mine: (filter: { status?: BookingStatus; cursor?: string; limit?: number }) =>
    api<Page<Booking>>(`/me/bookings${qs({ ...filter, limit: filter.limit ?? 20 })}`),

  /** Full refund (free bookings are simply cancelled). 202: the money goes back via the worker. */
  requestRefund: (id: string, reason: string, idempotencyKey: string) =>
    api<{ refund: NonNullable<Booking["refund"]> }>(`/bookings/${encodeURIComponent(id)}/refunds`, {
      method: "POST",
      body: { reason },
      headers: idem(idempotencyKey),
    }),
};

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: "success" | "neutral" | "danger" | "warning" | "accent" }> = {
  confirmed: { label: "Confirmed", tone: "success" },
  pending: { label: "Awaiting payment", tone: "accent" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  refunded: { label: "Refunded", tone: "warning" },
  partially_refunded: { label: "Partly refunded", tone: "warning" },
};

/** Server's REFUND_CUTOFF_HOURS (buyers can refund until this long before the start). The API enforces it. */
export const REFUND_CUTOFF_HOURS = 48;

export const paymentsApi = {
  providers: () => api<{ data: { name: ProviderName; currencies: string[] }[] }>("/payments/providers", { auth: false }),

  initiate: (bookingId: string, provider: ProviderName, idempotencyKey: string) =>
    api<{ payment: Payment; holdExpiresAt: string; action: CheckoutAction }>(
      `/bookings/${encodeURIComponent(bookingId)}/payments`,
      { method: "POST", body: { provider }, headers: idem(idempotencyKey) },
    ),

  /** Body depends on the gateway: { paymentId } | { pidx } | { data } | { sessionId }. */
  verify: (provider: ProviderName, body: Record<string, string>) =>
    api<VerifyResult>(`/payments/${provider}/verify`, { method: "POST", body }),

  /** Dev only: play the buyer paying on the fake gateway. */
  mockComplete: (paymentId: string, outcome: "success" | "failure") =>
    api<{ paymentId: string; outcome: string }>("/payments/mock/complete", { method: "POST", body: { paymentId, outcome } }),
};

export const PROVIDER_INFO: Record<ProviderName, { label: string; description: string }> = {
  esewa: { label: "eSewa", description: "Pay from your eSewa wallet" },
  khalti: { label: "Khalti", description: "Wallet, mobile banking or cards via Khalti" },
  stripe: { label: "Card", description: "Visa, Mastercard and more (Stripe)" },
  mock: { label: "Test payment", description: "Development only: no real money moves" },
};

/** Sends the browser to the gateway: a plain redirect, or an auto-submitted POST form (eSewa). */
export function goToGateway(action: CheckoutAction) {
  if (action.type === "redirect") {
    window.location.assign(action.url);
    return;
  }
  const form = document.createElement("form");
  form.method = action.method;
  form.action = action.url;
  form.style.display = "none";
  for (const [name, value] of Object.entries(action.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
