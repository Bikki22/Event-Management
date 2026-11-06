import { Router } from "express";
import { authenticate, requireVerifiedEmail } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  adminListOrganizersQuery,
  createProfileBody,
  organizerSlugParams,
  organizerUserIdParams,
  payoutBody,
  reviewBody,
  updateProfileBody,
  type AdminListOrganizersQuery,
  type CreateProfileBody,
  type PayoutBody,
  type ReviewBody,
  type UpdateProfileBody,
} from "./organizers.schemas.js";
import * as organizers from "./organizers.service.js";

/** Mounted at /api/v1/me/organizer-profile (before the /me router). */
export const myOrganizerRouter = Router();

myOrganizerRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
myOrganizerRouter.use(authenticate);

myOrganizerRouter.post(
  "/",
  requireVerifiedEmail,
  validate({ body: createProfileBody }),
  async (req, res) => {
    const profile = await organizers.becomeOrganizer(
      req.auth!.userId,
      req.body as CreateProfileBody,
      req.ip ?? null,
    );
    res.status(201).location("/api/v1/me/organizer-profile").json({ profile });
  },
);

myOrganizerRouter.get("/", async (req, res) => {
  res.json({ profile: await organizers.getMine(req.auth!.userId) });
});

myOrganizerRouter.patch("/", validate({ body: updateProfileBody }), async (req, res) => {
  const profile = await organizers.updateMine(
    req.auth!.userId,
    req.body as UpdateProfileBody,
    req.ip ?? null,
  );
  res.json({ profile });
});

myOrganizerRouter.put("/payout", validate({ body: payoutBody }), async (req, res) => {
  const profile = await organizers.setPayout(
    req.auth!.userId,
    req.body as PayoutBody,
    req.ip ?? null,
  );
  res.json({ profile });
});

myOrganizerRouter.delete("/payout", async (req, res) => {
  await organizers.removePayout(req.auth!.userId, req.ip ?? null);
  res.status(204).end();
});

/** Mounted at /api/v1/organizers (public). */
export const organizersRouter = Router();

organizersRouter.get("/:slug", validate({ params: organizerSlugParams }), async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(await organizers.getPublic((req.params as { slug: string }).slug));
});

/** Mounted at /api/v1/admin/organizers. The admin router enforces authenticate + requireRole("admin"). */
export const adminOrganizersRouter = Router();

adminOrganizersRouter.get("/", validate({ query: adminListOrganizersQuery }), async (req, res) => {
  res.json(await organizers.adminList(req.query as unknown as AdminListOrganizersQuery));
});

adminOrganizersRouter.get(
  "/:userId",
  validate({ params: organizerUserIdParams }),
  async (req, res) => {
    res.json({
      organizer: await organizers.adminGet((req.params as { userId: string }).userId),
    });
  },
);

adminOrganizersRouter.patch(
  "/:userId/verification",
  validate({ params: organizerUserIdParams, body: reviewBody }),
  async (req, res) => {
    const organizer = await organizers.adminReview(
      req.auth!.userId,
      (req.params as { userId: string }).userId,
      req.body as ReviewBody,
      req.ip ?? null,
    );
    res.json({ organizer });
  },
);
