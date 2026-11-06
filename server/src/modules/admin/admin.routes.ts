import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { adminCategoriesRouter } from "../categories/categories.routes.js";
import { adminOrganizersRouter } from "../organizers/organizers.routes.js";
import { adminUsersRouter } from "../users/users.routes.js";

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
