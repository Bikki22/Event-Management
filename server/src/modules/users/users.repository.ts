import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import type { AdminListUsersQuery } from "./users.schemas.js";

export const findUserById = (id: string, db: DbOrTx = prisma) =>
  db.user.findUnique({ where: { id } });

export const updateUser = (id: string, data: Prisma.UserUpdateInput, db: DbOrTx = prisma) =>
  db.user.update({ where: { id }, data });

export const countActiveSessions = (userId: string, db: DbOrTx = prisma) =>
  db.authSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } });

/**
 * Newest first, keyset-paginated on id (uuidv7 ids are time-ordered).
 * Fetches limit + 1 rows so the caller can tell whether there is another page.
 */
export function listUsers(
  filter: Omit<AdminListUsersQuery, "cursor">,
  afterId: string | undefined,
  db: DbOrTx = prisma,
) {
  const where: Prisma.UserWhereInput = {
    ...(filter.role ? { role: filter.role } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.q
      ? {
          OR: [
            { email: { contains: filter.q, mode: "insensitive" } },
            { fullName: { contains: filter.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(afterId ? { id: { lt: afterId } } : {}),
  };
  return db.user.findMany({ where, orderBy: { id: "desc" }, take: filter.limit + 1 });
}
