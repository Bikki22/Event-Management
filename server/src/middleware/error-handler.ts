import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { getContext } from "../lib/context.js";
import { AppError, mapDbError, NotFound, type FieldError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const PROBLEM_BASE = "https://api.ems.local/problems/";

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance: string;
  requestId?: string;
  details?: unknown;
  errors?: FieldError[];
}

const slug = (code: string) => code.toLowerCase().replace(/_/g, "-");

/** 404 for any route that didn't match. Register after all routers. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(NotFound(`Route ${req.method} ${req.path}`));
};

/** Turns any thrown error into an RFC 9457 problem+json response. Register last. */
export const errorHandler: ErrorRequestHandler = (rawErr, req, res, _next) => {
  const requestId = getContext()?.requestId;
  let problem: Problem;

  // Prisma / Postgres errors that map to a known API error (unique, FK, CHECK, deadlock, timeout)
  const mapped = rawErr instanceof AppError ? null : mapDbError(rawErr);
  if (mapped) logger.warn({ err: rawErr }, "database error mapped to API error");
  const err = mapped ?? rawErr;

  if (err instanceof AppError) {
    problem = {
      type: PROBLEM_BASE + slug(err.code),
      title: err.message,
      status: err.status,
      code: err.code,
      instance: req.originalUrl,
      requestId,
      details: err.details,
      errors: err.errors,
    };
    if (err.status >= 500) logger.error({ err }, err.message);
    else logger.info({ code: err.code, status: err.status }, err.message);
  } else if (err instanceof ZodError) {
    problem = {
      type: PROBLEM_BASE + "validation-failed",
      title: "Request validation failed",
      status: 400,
      code: "VALIDATION_FAILED",
      instance: req.originalUrl,
      requestId,
      errors: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  } else if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    // body-parser errors from express.json()
    const tooLarge = err.type === "entity.too.large";
    problem = {
      type: PROBLEM_BASE + (tooLarge ? "payload-too-large" : "malformed-json"),
      title: tooLarge ? "Request body too large" : "Malformed JSON body",
      status: tooLarge ? 413 : 400,
      code: tooLarge ? "PAYLOAD_TOO_LARGE" : "MALFORMED_JSON",
      instance: req.originalUrl,
      requestId,
    };
  } else {
    // Unknown: full details in logs only, generic message to the client.
    logger.error({ err }, "unhandled error");
    problem = {
      type: PROBLEM_BASE + "internal-error",
      title: "Internal server error",
      status: 500,
      code: "INTERNAL_ERROR",
      instance: req.originalUrl,
      requestId,
    };
  }

  if (res.headersSent) return;
  res.status(problem.status).type("application/problem+json").json(problem);
};
