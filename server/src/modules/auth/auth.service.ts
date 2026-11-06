import { env } from "../../config/env.js";
import { maskEmail, sha256 } from "../../lib/crypto.js";
import {
  AppError,
  BadRequest,
  Conflict,
  Forbidden,
  isUniqueViolation,
  NotFound,
  Unauthorized,
} from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { dispatch, queueEmail } from "../notifications/notifications.service.js";
import { toUserDto, type UserDto } from "../users/users.dto.js";
import * as repo from "./auth.repository.js";
import type { ClientMeta } from "./auth.repository.js";
import type {
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
} from "./auth.schemas.js";
import { hashPassword, verifyDummy, verifyPassword } from "./password.js";
import { invalidateUserState, markSessionsRevoked } from "./session-state.js";
import { signAccessToken } from "./tokens.js";

const log = logger.child({ module: "auth" });

const TX_OPTS = { maxWait: 2_000, timeout: 5_000 } as const;
const EMAIL_VERIFY_TTL_MS = env.EMAIL_VERIFY_TTL_HOURS * 3_600_000;
const PASSWORD_RESET_TTL_MS = env.PASSWORD_RESET_TTL_MINUTES * 60_000;
/** Two tabs refreshing at once: the loser presents a just-rotated token. Don't treat that as theft. */
const REUSE_GRACE_MS = 10_000;

export interface AuthResult {
  user: UserDto;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const invalidCredentials = () => Unauthorized("INVALID_CREDENTIALS", "Invalid email or password");
const refreshInvalid = () =>
  Unauthorized("REFRESH_INVALID", "Session expired, please sign in again");
const invalidLinkToken = () =>
  BadRequest("INVALID_OR_EXPIRED_TOKEN", "This link is invalid or has expired");

// ───────────── register / login ─────────────

export async function register(input: RegisterBody, meta: ClientMeta): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password); // CPU work outside the transaction

  try {
    const { user, sessionId, refresh, notificationId } = await prisma.$transaction(async (tx) => {
      const user = await repo.createUser(
        {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          phone: input.phone ?? null,
        },
        tx,
      );
      const { sessionId, refresh } = await repo.createSession(user.id, meta, tx);
      const token = await repo.issueVerificationToken(
        user.id,
        "email_verify",
        EMAIL_VERIFY_TTL_MS,
        tx,
      );
      const notificationId = await queueEmail(tx, {
        userId: user.id,
        to: user.email,
        type: "auth.verify_email",
        payload: { name: user.fullName, token },
      });
      return { user, sessionId, refresh, notificationId };
    }, TX_OPTS);

    await dispatch([notificationId]);
    log.info({ userId: user.id }, "auth.registered");

    return {
      user: toUserDto(user),
      accessToken: await signAccessToken({ userId: user.id, role: user.role, sessionId }),
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.expiresAt,
    };
  } catch (err) {
    if (isUniqueViolation(err, "email")) {
      throw Conflict("EMAIL_TAKEN", "An account with this email already exists");
    }
    throw err;
  }
}

export async function login(input: LoginBody, meta: ClientMeta): Promise<AuthResult> {
  const user = await repo.findUserByEmail(input.email);

  // Always run exactly one argon2 verify, so timing doesn't reveal whether the email exists.
  const ok =
    user?.passwordHash != null
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyDummy(input.password);

  if (!user || !ok || user.status === "deleted") {
    log.warn({ email: maskEmail(input.email), ip: meta.ip }, "auth.login_failed");
    throw invalidCredentials();
  }
  // Only reveal suspension after the correct password.
  if (user.status === "suspended") {
    throw Forbidden("ACCOUNT_SUSPENDED", "This account has been suspended");
  }

  const { sessionId, refresh } = await prisma.$transaction(async (tx) => {
    const created = await repo.createSession(user.id, meta, tx);
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return created;
  }, TX_OPTS);

  log.info({ userId: user.id, sessionId }, "auth.login");
  return {
    user: toUserDto(user),
    accessToken: await signAccessToken({ userId: user.id, role: user.role, sessionId }),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: refresh.raw,
    refreshExpiresAt: refresh.expiresAt,
  };
}

// ───────────── refresh (rotation + reuse detection) ─────────────

type RefreshOutcome =
  | { kind: "ok"; userId: string; sessionId: string; next: { raw: string; expiresAt: Date } }
  | { kind: "invalid" }
  | { kind: "reused"; userId: string; sessionId: string };

export async function refresh(rawToken: string, meta: ClientMeta): Promise<RefreshResult> {
  // Decide inside one transaction (rows locked); throw only after commit so a reuse revoke persists.
  const outcome = await prisma.$transaction(async (tx): Promise<RefreshOutcome> => {
    const t = await repo.lockRefreshToken(sha256(rawToken), tx);
    if (!t || t.session_revoked_at) return { kind: "invalid" };

    if (t.used_at) {
      if (t.now.getTime() - t.used_at.getTime() < REUSE_GRACE_MS) return { kind: "invalid" };
      await repo.revokeSession(t.session_id, t.user_id, "reuse_detected", tx);
      return { kind: "reused", userId: t.user_id, sessionId: t.session_id };
    }

    if (t.expires_at <= t.now || t.session_expires_at <= t.now) return { kind: "invalid" };

    const next = await repo.rotateRefreshToken(t, meta, tx);
    return { kind: "ok", userId: t.user_id, sessionId: t.session_id, next };
  }, TX_OPTS);

  if (outcome.kind === "invalid") throw refreshInvalid();
  if (outcome.kind === "reused") {
    await markSessionsRevoked([outcome.sessionId]);
    log.warn(
      { userId: outcome.userId, sessionId: outcome.sessionId, ip: meta.ip },
      "auth.refresh_reuse_detected: session revoked",
    );
    throw Unauthorized("REFRESH_REUSED", "Session revoked for security reasons, sign in again");
  }

  const user = await repo.findUserById(outcome.userId);
  if (!user || user.status !== "active") {
    await repo.revokeSession(outcome.sessionId, outcome.userId, "user_inactive");
    await markSessionsRevoked([outcome.sessionId]);
    throw refreshInvalid();
  }

  return {
    accessToken: await signAccessToken({
      userId: user.id,
      role: user.role,
      sessionId: outcome.sessionId,
    }),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: outcome.next.raw,
    refreshExpiresAt: outcome.next.expiresAt,
  };
}

// ───────────── logout / sessions ─────────────

export async function logout(userId: string, sessionId: string): Promise<void> {
  await repo.revokeSession(sessionId, userId, "logout");
  await markSessionsRevoked([sessionId]);
  log.info({ sessionId }, "auth.logout");
}

export async function listSessions(userId: string, currentSessionId: string) {
  const rows = await repo.listActiveSessions(userId);
  return rows.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    current: s.id === currentSessionId,
  }));
}

export async function revokeSessionById(userId: string, sessionId: string): Promise<void> {
  const revoked = await repo.revokeSession(sessionId, userId, "revoked_by_user");
  if (!revoked) throw NotFound("Session"); // also covers "not yours" (no existence leak)
  await markSessionsRevoked([sessionId]);
  log.info({ sessionId }, "auth.session_revoked");
}

// ───────────── email verification ─────────────

export async function verifyEmail(rawToken: string): Promise<UserDto> {
  const user = await prisma.$transaction(async (tx) => {
    const userId = await repo.consumeVerificationToken(rawToken, "email_verify", tx);
    if (!userId) return null;
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (current.emailVerifiedAt) return current;
    return tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }, TX_OPTS);

  if (!user) throw invalidLinkToken();
  await invalidateUserState(user.id);
  log.info({ userId: user.id }, "auth.email_verified");
  return toUserDto(user);
}

export async function resendVerification(userId: string): Promise<void> {
  const notificationId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) throw Conflict("ALREADY_VERIFIED", "Email is already verified");
    const token = await repo.issueVerificationToken(
      user.id,
      "email_verify",
      EMAIL_VERIFY_TTL_MS,
      tx,
    );
    return queueEmail(tx, {
      userId: user.id,
      to: user.email,
      type: "auth.verify_email",
      payload: { name: user.fullName, token },
    });
  }, TX_OPTS);
  await dispatch([notificationId]);
}

// ───────────── forgot / reset / change password ─────────────

/**
 * Runs AFTER the 202 response has been sent (see route), so the response is identical
 * and equally fast whether or not the email exists. Never throws to the caller.
 */
export async function forgotPassword(email: string, meta: ClientMeta): Promise<void> {
  try {
    const user = await repo.findUserByEmail(email);
    if (!user || user.status !== "active") {
      log.info({ email: maskEmail(email), ip: meta.ip }, "auth.forgot_password_unknown_email");
      return;
    }
    const notificationId = await prisma.$transaction(async (tx) => {
      const token = await repo.issueVerificationToken(
        user.id,
        "password_reset",
        PASSWORD_RESET_TTL_MS,
        tx,
      );
      return queueEmail(tx, {
        userId: user.id,
        to: user.email,
        type: "auth.password_reset",
        payload: { name: user.fullName, token },
      });
    }, TX_OPTS);
    await dispatch([notificationId]);
    log.info({ userId: user.id }, "auth.password_reset_requested");
  } catch (err) {
    log.error({ err }, "forgot-password processing failed");
  }
}

export async function resetPassword(input: ResetPasswordBody, meta: ClientMeta): Promise<void> {
  const passwordHash = await hashPassword(input.newPassword);

  const result = await prisma.$transaction(async (tx) => {
    const userId = await repo.consumeVerificationToken(input.token, "password_reset", tx);
    if (!userId) return null;
    const before = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        // they proved they own the inbox
        emailVerifiedAt: before.emailVerifiedAt ?? new Date(),
      },
    });
    const revokedIds = await repo.revokeAllSessions(userId, "password_reset", tx);
    // other outstanding reset links die too
    await tx.verificationToken.updateMany({
      where: { userId, purpose: "password_reset", usedAt: null },
      data: { usedAt: new Date() },
    });
    const notificationId = await queueEmail(tx, {
      userId,
      to: user.email,
      type: "auth.password_changed",
      payload: { name: user.fullName, changedAt: new Date().toISOString() },
    });
    await repo.writeAudit(
      {
        actorId: userId,
        action: "auth.password_reset",
        entityType: "user",
        entityId: userId,
        ip: meta.ip,
        diff: { sessionsRevoked: revokedIds.length },
      },
      tx,
    );
    return { userId, revokedIds, notificationId };
  }, TX_OPTS);

  if (!result) throw invalidLinkToken();
  await markSessionsRevoked(result.revokedIds);
  await invalidateUserState(result.userId);
  await dispatch([result.notificationId]);
  log.info({ userId: result.userId }, "auth.password_reset");
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  input: ChangePasswordBody,
  meta: ClientMeta,
): Promise<void> {
  const user = await repo.findUserById(userId);
  if (!user) throw Unauthorized();
  const ok = user.passwordHash
    ? await verifyPassword(user.passwordHash, input.currentPassword)
    : false;
  if (!ok) throw new AppError(401, "INVALID_CREDENTIALS", "Current password is incorrect");

  const passwordHash = await hashPassword(input.newPassword);
  const { revokedIds, notificationId } = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    // keep this device signed in, sign out every other one
    const revokedIds = await repo.revokeAllSessions(
      userId,
      "password_changed",
      tx,
      currentSessionId,
    );
    const notificationId = await queueEmail(tx, {
      userId,
      to: user.email,
      type: "auth.password_changed",
      payload: { name: user.fullName, changedAt: new Date().toISOString() },
    });
    await repo.writeAudit(
      {
        actorId: userId,
        action: "auth.password_changed",
        entityType: "user",
        entityId: userId,
        ip: meta.ip,
        diff: { sessionsRevoked: revokedIds.length },
      },
      tx,
    );
    return { revokedIds, notificationId };
  }, TX_OPTS);

  await markSessionsRevoked(revokedIds);
  await dispatch([notificationId]);
  log.info({ userId }, "auth.password_changed");
}
