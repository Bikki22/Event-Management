import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import type { UserRole } from "../generated/prisma/enums.js";
import { setUserId } from "../lib/context.js";
import { AppError, Forbidden, ServiceUnavailable, Unauthorized } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { loadUserState, readAuthState } from "../modules/auth/session-state.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: UserRole;
  emailVerified: boolean;
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

async function resolve(token: string): Promise<AuthContext> {
  const claims = await verifyAccessToken(token);

  let state;
  try {
    state = await readAuthState(claims.sessionId, claims.userId);
    if (state.revoked) throw Unauthorized("SESSION_REVOKED", "Session has ended, sign in again");
    state.user ??= await loadUserState(claims.userId);
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Can't confirm the session is still valid → fail closed.
    logger.error({ err }, "auth state lookup failed");
    throw ServiceUnavailable("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable");
  }

  const user = state.user;
  if (!user || user.status === "deleted")
    throw Unauthorized("TOKEN_INVALID", "Invalid access token");
  if (user.status === "suspended") {
    throw Forbidden("ACCOUNT_SUSPENDED", "This account has been suspended");
  }

  // role comes from the (≤60 s) cache, not the JWT, so promotions/demotions apply quickly
  return {
    userId: claims.userId,
    sessionId: claims.sessionId,
    role: user.role,
    emailVerified: user.emailVerified,
  };
}

/** Requires a valid `Authorization: Bearer <access token>`; sets `req.auth`. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = bearer(req.headers.authorization);
  if (!token) throw Unauthorized("UNAUTHORIZED", "Authentication required");
  req.auth = await resolve(token);
  setUserId(req.auth.userId);
  next();
};

/** Like `authenticate`, but anonymous requests pass through (an invalid token still fails). */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = bearer(req.headers.authorization);
  if (token) {
    req.auth = await resolve(token);
    setUserId(req.auth.userId);
  }
  next();
};

/** Use after `authenticate`. */
export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw Unauthorized();
    if (!roles.includes(req.auth.role)) throw Forbidden();
    next();
  };

/** Use after `authenticate`, e.g. on booking and become-organizer routes. */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw Unauthorized();
  if (!req.auth.emailVerified) {
    throw Forbidden("EMAIL_NOT_VERIFIED", "Verify your email address to continue");
  }
  next();
};

/**
 * CSRF guard for cookie-authenticated endpoints (/auth/refresh): the cookie is SameSite=Strict,
 * and we also require a custom header (forces a CORS preflight) plus an allowed Origin if present.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  const origin = req.get("origin");
  const hasHeader = Boolean(req.get("x-requested-with"));
  if (!hasHeader || (origin && !env.CORS_ORIGINS.includes(origin))) {
    logger.warn({ origin, hasHeader }, "auth.csrf_check_failed");
    throw Forbidden("CSRF_CHECK_FAILED", "Request blocked");
  }
  next();
};
