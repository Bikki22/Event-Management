import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { runWithContext } from "../lib/context.js";

const VALID_ID = /^[\w-]{8,64}$/;

/**
 * Accepts a well-formed X-Request-Id from the proxy (or generates one),
 * echoes it back, and runs the rest of the request inside an ALS context.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.headers["x-request-id"];
  const id = typeof incoming === "string" && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-request-id", id);
  runWithContext({ requestId: id }, next);
};
