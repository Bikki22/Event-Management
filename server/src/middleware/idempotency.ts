import type { RequestHandler } from "express";
import { sha256 } from "../lib/crypto.js";
import { AppError, BadRequest, Conflict } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/redis.js";

/**
 * Idempotency-Key handling (backend.md §4.5) for money-related POSTs.
 *  - first request: SET NX "in_progress" (60 s), run the handler, store {status, body} for 24 h
 *  - same key + same request again: replay the stored response (header Idempotent-Replayed: true)
 *  - same key while the first is still running: 409 REQUEST_IN_PROGRESS
 *  - same key with a different body/route: 422 IDEMPOTENCY_KEY_REUSED
 * 5xx responses are not stored, so the client can retry with the same key.
 * The DB keeps a UNIQUE (user_id, idempotency_key) as the last line of defence.
 * Use after `authenticate` and `validate`.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const IN_PROGRESS_TTL = 60;
const RESULT_TTL = 24 * 3600;

interface Stored {
  state: "in_progress" | "done";
  hash: string;
  status?: number;
  body?: unknown;
}

export const idempotent: RequestHandler = async (req, res, next) => {
  const key = req.get("idempotency-key");
  if (!key) {
    throw BadRequest(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Send an Idempotency-Key header (e.g. a UUID) so retries can't create duplicates",
    );
  }
  if (!KEY_PATTERN.test(key)) {
    throw BadRequest(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key must be 8-100 chars of A-Z a-z 0-9 _ -",
    );
  }

  const redisKey = `idem:${req.auth!.userId}:${key}`;
  const hash = sha256(`${req.method} ${req.baseUrl}${req.path} ${JSON.stringify(req.body ?? {})}`);
  const claimed = await redis.set(
    redisKey,
    JSON.stringify({ state: "in_progress", hash } satisfies Stored),
    "EX",
    IN_PROGRESS_TTL,
    "NX",
  );

  if (!claimed) {
    const raw = await redis.get(redisKey);
    const existing = raw ? (JSON.parse(raw) as Stored) : null;
    if (existing && existing.hash !== hash) {
      throw new AppError(
        422,
        "IDEMPOTENCY_KEY_REUSED",
        "This Idempotency-Key was already used for a different request",
      );
    }
    if (!existing || existing.state === "in_progress") {
      throw Conflict("REQUEST_IN_PROGRESS", "The same request is still being processed");
    }
    res.setHeader("Idempotent-Replayed", "true");
    res.status(existing.status!).json(existing.body);
    return;
  }

  let settled = false;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    settled = true;
    const op =
      res.statusCode >= 500
        ? redis.del(redisKey)
        : redis.set(
            redisKey,
            JSON.stringify({ state: "done", hash, status: res.statusCode, body } satisfies Stored),
            "EX",
            RESULT_TTL,
          );
    op.catch((err: unknown) => logger.warn({ err }, "idempotency store failed"));
    return json(body);
  };
  // response ended without JSON (or connection dropped): free the key for a retry
  res.on("close", () => {
    if (!settled) redis.del(redisKey).catch(() => undefined);
  });
  next();
};
