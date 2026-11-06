import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { adminCategoriesRouter } from "../categories/categories.routes.js";
import { adminOrganizersRouter } from "../organizers/organizers.routes.js";
import { completeManually, retry } from "../payments/refunds.service.js";
import { adminUsersRouter } from "../users/users.routes.js";
import * as admin from "./admin.service.js";

/**
 * Mounted at /api/v1/admin. Every route below requires an authenticated admin;
 * the check lives here at router level so a new admin route can't forget it.
 */
export const adminRouter = Router();

adminRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
adminRouter.use(authenticate, requireRole("admin"));

adminRouter.use("/users", adminUsersRouter);
adminRouter.use("/categories", adminCategoriesRouter);
adminRouter.use("/organizers", adminOrganizersRouter);

adminRouter.get("/stats", async (_req, res) => {
  res.json(await admin.stats());
});

adminRouter.get("/audit-logs", validate({ query: admin.auditQuery }), async (req, res) => {
  res.json(await admin.auditLogs(req.query as unknown as admin.AuditQuery));
});

adminRouter.get("/payments", validate({ query: admin.paymentsQuery }), async (req, res) => {
  res.json(await admin.payments(req.query as unknown as z.infer<typeof admin.paymentsQuery>));
});

adminRouter.get("/refunds", validate({ query: admin.refundsQuery }), async (req, res) => {
  res.json(await admin.refunds(req.query as unknown as z.infer<typeof admin.refundsQuery>));
});

const refundParams = z.object({ id: z.uuid() });

// after refunding by hand (eSewa has no refund API) or fixing a failed refund outside the system
adminRouter.post(
  "/refunds/:id/complete",
  validate({
    params: refundParams,
    body: z.object({ providerRefundId: z.string().trim().min(1).max(200).optional() }).strict(),
  }),
  async (req, res) => {
    const refund = await completeManually(
      req.auth!,
      (req.params as { id: string }).id,
      (req.body as { providerRefundId?: string }).providerRefundId,
      req.ip ?? null,
    );
    res.json({ refund });
  },
);

adminRouter.post("/refunds/:id/retry", validate({ params: refundParams }), async (req, res) => {
  res.json({ refund: await retry(req.auth!, (req.params as { id: string }).id, req.ip ?? null) });
});
