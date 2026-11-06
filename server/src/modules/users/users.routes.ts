import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { getMe } from "./users.service.js";

/** Mounted at /api/v1/me */
export const meRouter = Router();

meRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

meRouter.get("/", authenticate, async (req, res) => {
  res.json({ user: await getMe(req.auth!.userId) });
});
