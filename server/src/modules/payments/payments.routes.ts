import express, { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { NotFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/auth.js";
import { idempotent } from "../../middleware/idempotency.js";
import { byUser, limiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import * as payments from "./payments.service.js";
import { setMockOutcome } from "./providers/index.js";
import { requestRefund } from "./refunds.service.js";

const noStore = Router();
noStore.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

const idParams = z.object({ id: z.uuid() });
const providerParams = z.object({ provider: z.enum(["khalti", "esewa", "stripe", "mock"]) });

/** Mounted at /api/v1/bookings (payments + refunds of one booking), before the bookings router. */
export const bookingPaymentsRouter = Router();

bookingPaymentsRouter.post(
  "/:id/payments",
  noStore,
  authenticate,
  limiter({ name: "payment-initiate", windowMs: 60_000, limit: 10, key: byUser }),
  validate({ params: idParams, body: z.object({ provider: z.string().min(1).max(20) }).strict() }),
  idempotent,
  async (req, res) => {
    const result = await payments.initiate(
      req.auth!,
      (req.params as { id: string }).id,
      (req.body as { provider: string }).provider,
    );
    res.status(201).json(result);
  },
);

bookingPaymentsRouter.post(
  "/:id/refunds",
  noStore,
  authenticate,
  validate({
    params: idParams,
    body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  }),
  idempotent,
  async (req, res) => {
    const { refund, created } = await requestRefund(
      { kind: "user", auth: req.auth! },
      (req.params as { id: string }).id,
      (req.body as { reason: string }).reason,
      req.ip ?? null,
    );
    // 202: the money is sent back asynchronously by the refunds worker
    res.status(created ? 202 : 200).json({ refund });
  },
);

/** Mounted at /api/v1/payments */
export const paymentsRouter = Router();

paymentsRouter.get("/providers", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ data: payments.listProviders() });
});

paymentsRouter.post(
  "/:provider/verify",
  noStore,
  authenticate,
  limiter({ name: "payment-verify", windowMs: 60_000, limit: 30, key: byUser }),
  validate({ params: providerParams, body: z.record(z.string(), z.unknown()) }),
  async (req, res) => {
    const result = await payments.verify(
      req.auth!,
      (req.params as { provider: string }).provider,
      req.body as Record<string, unknown>,
    );
    res.json(result);
  },
);

// Plays the buyer paying on the fake gateway (PAYMENT_MOCK_ENABLED only; refused in production).
paymentsRouter.post(
  "/mock/complete",
  noStore,
  authenticate,
  validate({
    body: z.object({ paymentId: z.uuid(), outcome: z.enum(["success", "failure"]) }).strict(),
  }),
  async (req, res) => {
    if (!env.PAYMENT_MOCK_ENABLED) throw NotFound("Route");
    const { paymentId, outcome } = req.body as {
      paymentId: string;
      outcome: "success" | "failure";
    };
    const p = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: true },
    });
    if (!p || p.provider !== "mock" || p.booking.userId !== req.auth!.userId)
      throw NotFound("Payment");
    await setMockOutcome(paymentId, outcome);
    res.json({ paymentId, outcome, next: "POST /api/v1/payments/mock/verify { paymentId }" });
  },
);

paymentsRouter.get(
  "/:id",
  noStore,
  authenticate,
  validate({ params: idParams }),
  async (req, res) => {
    res.json({ payment: await payments.getPayment(req.auth!, (req.params as { id: string }).id) });
  },
);

/**
 * Mounted at /api/v1/webhooks BEFORE express.json(): signature checks need the exact raw bytes.
 * Only Stripe sends signed webhooks; Khalti and eSewa are confirmed via verify + reconciliation.
 */
export const webhooksRouter = Router();
webhooksRouter.post("/stripe", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  res.json(await payments.receiveStripeWebhook(body, req.get("stripe-signature")));
});
