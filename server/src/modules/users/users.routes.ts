import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  adminListUsersQuery,
  adminUpdateUserBody,
  updateMeBody,
  userIdParams,
  type AdminListUsersQuery,
  type AdminUpdateUserBody,
  type UpdateMeBody,
} from "./users.schemas.js";
import * as users from "./users.service.js";

/** Mounted at /api/v1/me */
export const meRouter = Router();

meRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
meRouter.use(authenticate);

meRouter.get("/", async (req, res) => {
  res.json({ user: await users.getMe(req.auth!.userId) });
});

meRouter.patch("/", validate({ body: updateMeBody }), async (req, res) => {
  res.json({ user: await users.updateMe(req.auth!.userId, req.body as UpdateMeBody) });
});

/** Mounted at /api/v1/admin/users. The admin router enforces authenticate + requireRole("admin"). */
export const adminUsersRouter = Router();

adminUsersRouter.get("/", validate({ query: adminListUsersQuery }), async (req, res) => {
  res.json(await users.adminListUsers(req.query as unknown as AdminListUsersQuery));
});

adminUsersRouter.get("/:id", validate({ params: userIdParams }), async (req, res) => {
  res.json({ user: await users.adminGetUser((req.params as { id: string }).id) });
});

adminUsersRouter.patch(
  "/:id",
  validate({ params: userIdParams, body: adminUpdateUserBody }),
  async (req, res) => {
    const user = await users.adminUpdateUser(
      req.auth!.userId,
      (req.params as { id: string }).id,
      req.body as AdminUpdateUserBody,
      req.ip ?? null,
    );
    res.json({ user });
  },
);
