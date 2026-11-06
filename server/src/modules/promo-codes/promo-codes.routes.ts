import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { byUser, limiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import * as promos from "./promo-codes.service.js";

const noStore = Router();
noStore.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
const eventParams = z.object({ id: z.uuid() });

/** Mounted at /api/v1/events/:id/promo-codes (organizer of the event / admin). */
export const eventPromoCodesRouter = Router({ mergeParams: true });
eventPromoCodesRouter.use(noStore, authenticate);

eventPromoCodesRouter.get("/", validate({ params: eventParams }), async (req, res) => {
  res.json({ data: await promos.list(req.auth!, (req.params as { id: string }).id) });
});

eventPromoCodesRouter.post(
  "/",
  validate({ params: eventParams, body: promos.createPromoBody }),
  async (req, res) => {
    const promoCode = await promos.create(
      req.auth!,
      (req.params as { id: string }).id,
      req.body as promos.CreatePromoBody,
      req.ip ?? null,
    );
    res.status(201).json({ promoCode });
  },
);

eventPromoCodesRouter.patch(
  "/:promoId",
  validate({ params: promos.promoParams, body: promos.updatePromoBody }),
  async (req, res) => {
    const { id, promoId } = req.params as { id: string; promoId: string };
    const promoCode = await promos.update(
      req.auth!,
      id,
      promoId,
      req.body as promos.UpdatePromoBody,
      req.ip ?? null,
    );
    res.json({ promoCode });
  },
);

eventPromoCodesRouter.delete(
  "/:promoId",
  validate({ params: promos.promoParams }),
  async (req, res) => {
    const { id, promoId } = req.params as { id: string; promoId: string };
    await promos.remove(req.auth!, id, promoId, req.ip ?? null);
    res.status(204).end();
  },
);

/** Mounted at /api/v1/promo-codes */
export const promoCodesRouter = Router();
promoCodesRouter.use(noStore, authenticate);

// limited: stops guessing codes by brute force
promoCodesRouter.post(
  "/validate",
  limiter({ name: "promo-validate", windowMs: 60_000, limit: 20, key: byUser }),
  validate({ body: promos.validatePromoBody }),
  async (req, res) => {
    res.json(await promos.validate(req.body as promos.ValidatePromoBody));
  },
);
