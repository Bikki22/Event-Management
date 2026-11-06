import type { Prisma } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import { Conflict, Forbidden, NotFound, Unprocessable } from "../../lib/errors.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import type { AuthContext } from "../../middleware/auth.js";
import { requireOrganizerProfile } from "../organizers/organizers.service.js";
import { toVenueDto, type VenueDto } from "./venues.dto.js";
import type { CreateVenueBody, ListVenuesQuery, UpdateVenueBody } from "./venues.schemas.js";

/** Venues an organizer can pick: shared platform venues + their own. Admins see all. */
export async function list(auth: AuthContext, query: ListVenuesQuery): Promise<VenueDto[]> {
  const scope: Prisma.VenueWhereInput =
    query.mine === true
      ? { ownerId: auth.userId }
      : auth.role === "admin"
        ? {}
        : { OR: [{ ownerId: null }, { ownerId: auth.userId }] };
  const rows = await prisma.venue.findMany({
    where: {
      AND: [
        scope,
        { deletedAt: null },
        query.q ? { name: { contains: query.q, mode: "insensitive" } } : {},
        query.city ? { city: { equals: query.city, mode: "insensitive" } } : {},
      ],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: query.limit,
  });
  return rows.map(toVenueDto);
}

export async function get(id: string): Promise<VenueDto> {
  const venue = await prisma.venue.findFirst({ where: { id, deletedAt: null } });
  if (!venue) throw NotFound("Venue");
  return toVenueDto(venue);
}

export async function create(
  auth: AuthContext,
  input: CreateVenueBody,
  ip: string | null,
): Promise<VenueDto> {
  let ownerId: string | null;
  if (input.platform) {
    if (auth.role !== "admin") throw Forbidden("FORBIDDEN", "Only admins can create shared venues");
    ownerId = null;
  } else {
    ownerId = (await requireOrganizerProfile(auth.userId)).userId;
  }
  const { platform: _platform, ...data } = input;

  const venue = await prisma.$transaction(async (tx) => {
    const v = await tx.venue.create({ data: { ...data, ownerId } });
    await writeAudit(
      { actorId: auth.userId, action: "venue.created", entityType: "venue", entityId: v.id, ip },
      tx,
    );
    return v;
  });
  return toVenueDto(venue);
}

/** Owners manage their venues; admins manage all. Anyone else gets 404 (no existence leak). */
async function findManageable(auth: AuthContext, id: string, db: DbOrTx) {
  const venue = await db.venue.findFirst({ where: { id, deletedAt: null } });
  if (!venue) throw NotFound("Venue");
  if (auth.role !== "admin" && venue.ownerId !== auth.userId) throw NotFound("Venue");
  return venue;
}

export async function update(
  auth: AuthContext,
  id: string,
  input: UpdateVenueBody,
  ip: string | null,
): Promise<VenueDto> {
  const venue = await prisma.$transaction(async (tx) => {
    await findManageable(auth, id, tx);
    const v = await tx.venue.update({ where: { id }, data: input });
    await writeAudit(
      {
        actorId: auth.userId,
        action: "venue.updated",
        entityType: "venue",
        entityId: id,
        ip,
        diff: { fields: Object.keys(input) },
      },
      tx,
    );
    return v;
  });
  return toVenueDto(venue);
}

/** Soft delete. Refused while a draft or published event still uses the venue. */
export async function remove(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await findManageable(auth, id, tx);
    const inUse = await tx.event.count({
      where: { venueId: id, deletedAt: null, status: { in: ["draft", "published"] } },
    });
    if (inUse > 0) {
      throw Conflict("VENUE_IN_USE", `${inUse} event(s) still use this venue`);
    }
    await tx.venue.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(
      { actorId: auth.userId, action: "venue.deleted", entityType: "venue", entityId: id, ip },
      tx,
    );
  });
}

/** For events: the venue must exist and be a platform venue or the organizer's own. */
export async function requireUsableVenue(organizerId: string, venueId: string, db: DbOrTx) {
  const venue = await db.venue.findFirst({ where: { id: venueId, deletedAt: null } });
  if (!venue || (venue.ownerId !== null && venue.ownerId !== organizerId)) {
    throw Unprocessable("INVALID_VENUE", "Venue not found, or it isn't yours to use");
  }
  return venue;
}
