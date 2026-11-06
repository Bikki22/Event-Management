import { env } from "../../config/env.js";
import type { UserRole, UserStatus } from "../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";

/**
 * Redis-backed state that `authenticate` checks on every request (no DB hit on the hot path):
 *  - sess:revoked:{sid}  → set on logout/revoke so the JWT dies immediately, TTL = access token TTL
 *  - user:state:{id}     → status/role/email-verified, 60 s TTL, deleted on change
 */

const revokedKey = (sid: string) => `sess:revoked:${sid}`;
const userKey = (id: string) => `user:state:${id}`;
const USER_STATE_TTL = 60;

export interface UserState {
  status: UserStatus;
  role: UserRole;
  emailVerified: boolean;
}

export async function markSessionsRevoked(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  const pipe = redis.pipeline();
  for (const sid of sessionIds) pipe.set(revokedKey(sid), "1", "EX", env.ACCESS_TOKEN_TTL_SECONDS);
  await pipe.exec();
}

export async function invalidateUserState(userId: string): Promise<void> {
  await redis.del(userKey(userId));
}

/** One round trip: is the session revoked, and the cached user state (if any). */
export async function readAuthState(
  sessionId: string,
  userId: string,
): Promise<{ revoked: boolean; user: UserState | null }> {
  const [revoked, cached] = await redis.mget(revokedKey(sessionId), userKey(userId));
  return { revoked: revoked === "1", user: cached ? (JSON.parse(cached) as UserState) : null };
}

/** Loads user state from the DB and caches it. Returns null if the user no longer exists. */
export async function loadUserState(userId: string): Promise<UserState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, role: true, emailVerifiedAt: true },
  });
  if (!user) return null;
  const state: UserState = {
    status: user.status,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
  };
  await redis.set(userKey(userId), JSON.stringify(state), "EX", USER_STATE_TTL);
  return state;
}
