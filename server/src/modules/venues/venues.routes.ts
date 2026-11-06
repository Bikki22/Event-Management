import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createVenueBody,
  listVenuesQuery,
  updateVenueBody,
  venueIdParams,
  type CreateVenueBody,
  type ListVenuesQuery,
  type UpdateVenueBody,
} from "./venues.schemas.js";
import * as venues from "./venues.service.js";

/** Mounted at /api/v1/venues */
export const venuesRouter = Router();

// venue picker for organizers (platform venues + own)
venuesRouter.get("/", authenticate, validate({ query: listVenuesQuery }), async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ data: await venues.list(req.auth!, req.query as unknown as ListVenuesQuery) });
});

venuesRouter.get("/:id", validate({ params: venueIdParams }), async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ venue: await venues.get((req.params as { id: string }).id) });
});

venuesRouter.post("/", authenticate, validate({ body: createVenueBody }), async (req, res) => {
  const venue = await venues.create(req.auth!, req.body as CreateVenueBody, req.ip ?? null);
  res.status(201).location(`/api/v1/venues/${venue.id}`).json({ venue });
});

venuesRouter.patch(
  "/:id",
  authenticate,
  validate({ params: venueIdParams, body: updateVenueBody }),
  async (req, res) => {
    const venue = await venues.update(
      req.auth!,
      (req.params as { id: string }).id,
      req.body as UpdateVenueBody,
      req.ip ?? null,
    );
    res.json({ venue });
  },
);

venuesRouter.delete("/:id", authenticate, validate({ params: venueIdParams }), async (req, res) => {
  await venues.remove(req.auth!, (req.params as { id: string }).id, req.ip ?? null);
  res.status(204).end();
});
