import { Prisma } from "../../generated/prisma/client.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import { fullEventInclude, type FullEvent } from "./events.dto.js";
import type { ListEventsQuery } from "./events.schemas.js";

export const findFull = (where: Prisma.EventWhereInput, db: DbOrTx = prisma) =>
  db.event.findFirst({ where, include: fullEventInclude }) as Promise<FullEvent | null>;

export const findManyFull = (ids: string[], db: DbOrTx = prisma) =>
  db.event.findMany({ where: { id: { in: ids } }, include: fullEventInclude }) as Promise<
    FullEvent[]
  >;

/**
 * Public listing: published + public + not over yet, ordered by (starts_at, id) with a keyset
 * cursor. Returns limit + 1 ids; the caller loads full rows. All user input is bound as
 * parameters (Prisma.sql), never concatenated.
 */
export async function searchPublicIds(
  filter: Omit<ListEventsQuery, "cursor">,
  after: { startsAt: Date; id: string } | undefined,
  db: DbOrTx = prisma,
): Promise<string[]> {
  const conds: Prisma.Sql[] = [
    Prisma.sql`e.status = 'published'`,
    Prisma.sql`e.visibility = 'public'`,
    Prisma.sql`e.deleted_at IS NULL`,
    Prisma.sql`e.ends_at > now()`,
  ];
  if (filter.q) {
    conds.push(Prisma.sql`e.search_vector @@ websearch_to_tsquery('simple', ${filter.q})`);
  }
  if (filter.category) {
    conds.push(Prisma.sql`e.category_id IN (
      SELECT c.id FROM categories c
      WHERE c.slug = ${filter.category}
         OR c.parent_id = (SELECT p.id FROM categories p WHERE p.slug = ${filter.category}))`);
  }
  if (filter.city) conds.push(Prisma.sql`lower(v.city) = lower(${filter.city})`);
  if (filter.mode) conds.push(Prisma.sql`e.mode = ${filter.mode}::event_mode`);
  if (filter.organizer) {
    conds.push(
      Prisma.sql`e.organizer_id = (SELECT o.user_id FROM organizer_profiles o WHERE o.slug = ${filter.organizer})`,
    );
  }
  if (filter.from) conds.push(Prisma.sql`e.starts_at >= ${filter.from}`);
  if (filter.to) conds.push(Prisma.sql`e.starts_at < ${filter.to}`);
  if (after) conds.push(Prisma.sql`(e.starts_at, e.id) > (${after.startsAt}, ${after.id}::uuid)`);

  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT e.id
    FROM events e
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE ${Prisma.join(conds, " AND ")}
    ORDER BY e.starts_at, e.id
    LIMIT ${filter.limit + 1}`;
  return rows.map((r) => r.id);
}

/** Maintenance: published events that have ended become `completed`. */
export const completeEndedEvents = (db: DbOrTx = prisma) =>
  db.event.updateMany({
    where: { status: "published", endsAt: { lt: new Date() }, deletedAt: null },
    data: { status: "completed", version: { increment: 1 } },
  });
