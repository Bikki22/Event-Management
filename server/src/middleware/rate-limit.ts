import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { AppError, ServiceUnavailable } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/redis.js";

const store = (name: string) =>
  new RedisStore({
    prefix: `rl:${name}:`,
    sendCommand: (...args: string[]) =>
      redis.call(args[0]!, ...args.slice(1)) as Promise<RedisReply>,
  });

export const byIp = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");
export const byUser = (req: Request) => req.auth?.userId ?? byIp(req);
/** Keys on the (normalized) email in the body; requests without one aren't counted. */
export const byBodyEmail = (req: Request) => {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.trim()
    ? `email:${email.trim().toLowerCase()}`
    : undefined;
};

interface LimitOptions {
  /** Unique per limiter: becomes the Redis key prefix. */
  name: string;
  windowMs: number;
  limit: number;
  key: (req: Request) => string | undefined;
  /** true (default): if Redis is down, reject (503). false: allow the request. */
  failClosed?: boolean;
}

/** Redis-backed limiter shared by all API replicas. Responds 429 problem+json with RateLimit headers. */
export function limiter(opts: LimitOptions): RequestHandler {
  const failClosed = opts.failClosed ?? true;
  const mw = rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: store(opts.name),
    passOnStoreError: !failClosed,
    skip: (req) => opts.key(req) === undefined,
    keyGenerator: (req) => opts.key(req)!,
    handler: (req, _res, next, options) => {
      logger.warn({ limiter: opts.name, path: req.path }, "rate limit hit");
      next(new AppError(options.statusCode, "RATE_LIMITED", "Too many requests, try again later"));
    },
  });

  // Store errors (Redis down) surface here; turn them into a clean 503 instead of a 500.
  return (req, res, next) =>
    mw(req, res, (err?: unknown) => {
      if (err && !(err instanceof AppError)) {
        logger.error({ err, limiter: opts.name }, "rate limiter store unavailable");
        return next(
          ServiceUnavailable("RATE_LIMIT_UNAVAILABLE", "Service temporarily unavailable"),
        );
      }
      next(err);
    });
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Limits from auth.md §7. */
export const authLimits = {
  loginIp: limiter({ name: "login-ip", windowMs: MIN, limit: 5, key: byIp }),
  loginEmailMin: limiter({ name: "login-email-m", windowMs: MIN, limit: 5, key: byBodyEmail }),
  loginEmailHour: limiter({ name: "login-email-h", windowMs: HOUR, limit: 20, key: byBodyEmail }),
  register: limiter({ name: "register-ip", windowMs: MIN, limit: 5, key: byIp }),
  forgotEmail: limiter({ name: "forgot-email", windowMs: HOUR, limit: 3, key: byBodyEmail }),
  forgotIp: limiter({ name: "forgot-ip", windowMs: HOUR, limit: 10, key: byIp }),
  resendVerification: limiter({ name: "resend-verify", windowMs: HOUR, limit: 3, key: byUser }),
  refresh: limiter({ name: "refresh-ip", windowMs: MIN, limit: 30, key: byIp }),
  tokenLinks: limiter({ name: "token-links-ip", windowMs: MIN, limit: 10, key: byIp }),
};
