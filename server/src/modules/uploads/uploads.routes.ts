import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { byUser, limiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { presignBody, uploadIdParams, type PresignBody } from "./uploads.schemas.js";
import * as uploads from "./uploads.service.js";

/** Mounted at /api/v1/uploads */
export const uploadsRouter = Router();

uploadsRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
uploadsRouter.use(authenticate);

const presignLimit = limiter({
  name: "upload-presign",
  windowMs: 3_600_000,
  limit: 30,
  key: byUser,
});

uploadsRouter.post("/presign", presignLimit, validate({ body: presignBody }), async (req, res) => {
  res.status(201).json(await uploads.presign(req.auth!.userId, req.body as PresignBody));
});

uploadsRouter.post("/:id/complete", validate({ params: uploadIdParams }), async (req, res) => {
  const upload = await uploads.complete(req.auth!.userId, (req.params as { id: string }).id);
  res.status(upload.status === "ready" ? 200 : 202).json({ upload });
});

uploadsRouter.get("/:id", validate({ params: uploadIdParams }), async (req, res) => {
  res.json({ upload: await uploads.get(req.auth!.userId, (req.params as { id: string }).id) });
});
