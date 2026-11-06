import { writeAudit } from "../../lib/audit.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { decodeCursor, toPage, type Page } from "../../lib/pagination.js";
import { prisma } from "../../lib/prisma.js";
import { revokeAllSessions } from "../auth/auth.repository.js";
import { invalidateUserState, markSessionsRevoked } from "../auth/session-state.js";
import { toAdminUserDto, toUserDto, type AdminUserDto, type UserDto } from "./users.dto.js";
import * as repo from "./users.repository.js";
import type { AdminListUsersQuery, AdminUpdateUserBody, UpdateMeBody } from "./users.schemas.js";

const log = logger.child({ module: "users" });

// ───────────── /me ─────────────

export async function getMe(userId: string): Promise<UserDto> {
  const user = await repo.findUserById(userId);
  if (!user) throw NotFound("User");
  return toUserDto(user);
}

export async function updateMe(userId: string, input: UpdateMeBody): Promise<UserDto> {
  const user = await repo.updateUser(userId, {
    ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
  });
  log.info({ userId, fields: Object.keys(input) }, "users.profile_updated");
  return toUserDto(user);
}

// ───────────── admin ─────────────

const isIdCursor = (v: unknown): v is { id: string } =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { id?: unknown }).id === "string" &&
  /^[0-9a-f-]{36}$/i.test((v as { id: string }).id);

export async function adminListUsers(query: AdminListUsersQuery): Promise<Page<AdminUserDto>> {
  const { cursor, ...filter } = query;
  const afterId = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
  const rows = await repo.listUsers(filter, afterId);
  return toPage(rows, filter.limit, toAdminUserDto, (u) => ({ id: u.id }));
}

export async function adminGetUser(id: string) {
  const user = await repo.findUserById(id);
  if (!user) throw NotFound("User");
  const activeSessions = await repo.countActiveSessions(id);
  return { ...toAdminUserDto(user), activeSessions };
}

/**
 * Change a user's role and/or status. Suspending signs the user out everywhere right away;
 * a role change takes effect on their next request (the cached auth state is dropped).
 */
export async function adminUpdateUser(
  actorId: string,
  targetId: string,
  input: AdminUpdateUserBody,
  ip: string | null,
): Promise<AdminUserDto> {
  // Prevents an admin from locking themselves out or removing the last admin by accident
  if (actorId === targetId) {
    throw Forbidden("CANNOT_MODIFY_SELF", "You can't change your own role or status");
  }

  const { user, revokedIds } = await prisma.$transaction(async (tx) => {
    const before = await repo.findUserById(targetId, tx);
    if (!before || before.status === "deleted") throw NotFound("User");

    const user = await repo.updateUser(
      targetId,
      {
        ...(input.role ? { role: input.role } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      tx,
    );

    const revokedIds =
      input.status === "suspended" && before.status !== "suspended"
        ? await revokeAllSessions(targetId, "suspended", tx)
        : [];

    await writeAudit(
      {
        actorId,
        action: "admin.user_updated",
        entityType: "user",
        entityId: targetId,
        ip,
        diff: {
          before: { role: before.role, status: before.status },
          after: { role: user.role, status: user.status },
          sessionsRevoked: revokedIds.length,
        },
      },
      tx,
    );
    return { user, revokedIds };
  });

  await markSessionsRevoked(revokedIds);
  await invalidateUserState(targetId);
  log.info({ actorId, targetId, role: user.role, status: user.status }, "users.admin_updated");
  return toAdminUserDto(user);
}
