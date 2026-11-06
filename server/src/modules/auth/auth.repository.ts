import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { TokenPurpose } from "../../generated/prisma/enums.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import { newRefreshToken } from "./tokens.js";

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

// ───────────── users ─────────────

export const findUserByEmail = (email: string, db: DbOrTx = prisma) =>
  db.user.findUnique({ where: { email } }); // citext column: case-insensitive match

export const findUserById = (id: string, db: DbOrTx = prisma) =>
  db.user.findUnique({ where: { id } });

export const createUser = (data: Prisma.UserCreateInput, db: DbOrTx = prisma) =>
  db.user.create({ data });

// ───────────── sessions + refresh tokens ─────────────

/** New device session plus its first refresh token. */
export async function createSession(userId: string, meta: ClientMeta, db: DbOrTx = prisma) {
  const sessionExpiresAt = new Date(Date.now() + env.SESSION_MAX_DAYS * 86_400_000);
  const refresh = newRefreshToken(sessionExpiresAt);
  const session = await db.authSession.create({
    data: {
      userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: sessionExpiresAt,
      refreshTokens: { create: { tokenHash: refresh.hash, expiresAt: refresh.expiresAt } },
    },
    select: { id: true },
  });
  return { sessionId: session.id, refresh };
}

export interface LockedRefreshToken {
  id: string;
  session_id: string;
  expires_at: Date;
  used_at: Date | null;
  user_id: string;
  session_revoked_at: Date | null;
  session_expires_at: Date;
  now: Date;
}

/** Locks the token and its session so concurrent refreshes of the same session serialize. */
export async function lockRefreshToken(
  tokenHash: string,
  tx: DbOrTx,
): Promise<LockedRefreshToken | undefined> {
  const rows = await tx.$queryRaw<LockedRefreshToken[]>`
    SELECT rt.id, rt.session_id, rt.expires_at, rt.used_at,
           s.user_id, s.revoked_at AS session_revoked_at, s.expires_at AS session_expires_at,
           now() AS now
    FROM refresh_tokens rt
    JOIN auth_sessions s ON s.id = rt.session_id
    WHERE rt.token_hash = ${tokenHash}
    FOR UPDATE OF rt, s`;
  return rows[0];
}

/** Marks the presented token used and issues the next one in the same session. */
export async function rotateRefreshToken(locked: LockedRefreshToken, meta: ClientMeta, tx: DbOrTx) {
  const next = newRefreshToken(locked.session_expires_at);
  await tx.refreshToken.update({ where: { id: locked.id }, data: { usedAt: locked.now } });
  await tx.refreshToken.create({
    data: { sessionId: locked.session_id, tokenHash: next.hash, expiresAt: next.expiresAt },
  });
  await tx.authSession.update({
    where: { id: locked.session_id },
    data: { lastUsedAt: locked.now, ip: meta.ip, userAgent: meta.userAgent },
  });
  return next;
}

/** Revokes one session if it belongs to the user and is still active. Returns true if revoked. */
export async function revokeSession(
  sessionId: string,
  userId: string,
  reason: string,
  db: DbOrTx = prisma,
): Promise<boolean> {
  const { count } = await db.authSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  return count > 0;
}

/** Revokes every active session of a user (optionally keeping one). Returns the revoked ids. */
export async function revokeAllSessions(
  userId: string,
  reason: string,
  db: DbOrTx = prisma,
  exceptSessionId?: string,
): Promise<string[]> {
  const rows = await db.authSession.updateManyAndReturn({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokeReason: reason },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export const listActiveSessions = (userId: string, db: DbOrTx = prisma) =>
  db.authSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
    orderBy: { lastUsedAt: "desc" },
  });

// ───────────── email verification / password reset tokens ─────────────

/** Issues a single-use token; earlier unused tokens of the same purpose are invalidated. */
export async function issueVerificationToken(
  userId: string,
  purpose: TokenPurpose,
  ttlMs: number,
  tx: DbOrTx,
): Promise<string> {
  await tx.verificationToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
  const raw = randomToken(32);
  await tx.verificationToken.create({
    data: { userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return raw;
}

/** Atomically consumes a valid token (DB clock). Returns the user id, or null if invalid/used/expired. */
export async function consumeVerificationToken(
  raw: string,
  purpose: TokenPurpose,
  tx: DbOrTx,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ user_id: string }[]>`
    UPDATE verification_tokens
    SET used_at = now()
    WHERE token_hash = ${sha256(raw)}
      AND purpose = ${purpose}::token_purpose
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING user_id`;
  return rows[0]?.user_id ?? null;
}

// ───────────── audit ─────────────

export { writeAudit } from "../../lib/audit.js";
