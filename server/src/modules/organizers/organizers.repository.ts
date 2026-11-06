import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import type { AdminListOrganizersQuery } from "./organizers.schemas.js";

export const findByUserId = (userId: string, db: DbOrTx = prisma) =>
  db.organizerProfile.findUnique({ where: { userId } });

export const findByUserIdWithUser = (userId: string, db: DbOrTx = prisma) =>
  db.organizerProfile.findUnique({ where: { userId }, include: { user: true } });

export const findBySlugWithOwnerStatus = (slug: string, db: DbOrTx = prisma) =>
  db.organizerProfile.findUnique({
    where: { slug }, // citext: case-insensitive
    include: { user: { select: { status: true } } },
  });

export const create = (data: Prisma.OrganizerProfileUncheckedCreateInput, db: DbOrTx = prisma) =>
  db.organizerProfile.create({ data });

export const update = (
  userId: string,
  data: Prisma.OrganizerProfileUncheckedUpdateInput,
  db: DbOrTx = prisma,
) => db.organizerProfile.update({ where: { userId }, data });

/** Newest applications first; keyset on (createdAt, userId). Fetches limit + 1. */
export function list(
  filter: Omit<AdminListOrganizersQuery, "cursor">,
  after: { createdAt: Date; userId: string } | undefined,
  db: DbOrTx = prisma,
) {
  const and: Prisma.OrganizerProfileWhereInput[] = [];
  if (filter.status) and.push({ verificationStatus: filter.status });
  if (filter.q) {
    and.push({
      OR: [
        { orgName: { contains: filter.q, mode: "insensitive" } },
        { slug: { contains: filter.q, mode: "insensitive" } },
        { user: { email: { contains: filter.q, mode: "insensitive" } } },
      ],
    });
  }
  if (after) {
    and.push({
      OR: [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, userId: { lt: after.userId } },
      ],
    });
  }
  return db.organizerProfile.findMany({
    where: { AND: and },
    include: { user: true },
    orderBy: [{ createdAt: "desc" }, { userId: "desc" }],
    take: filter.limit + 1,
  });
}
