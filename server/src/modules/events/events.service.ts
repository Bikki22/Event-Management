import { randomBytes } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import {
  AppError,
  Conflict,
  Forbidden,
  isUniqueViolation,
  NotFound,
  PreconditionFailed,
  Unprocessable,
} from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { decodeCursor, toPage, type Page } from "../../lib/pagination.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import { slugify } from "../../lib/slug.js";
import type { AuthContext } from "../../middleware/auth.js";
import { requireOrganizerProfile } from "../organizers/organizers.service.js";
import { requireReadyUpload } from "../uploads/uploads.service.js";
import { requireUsableVenue } from "../venues/venues.service.js";
import {
  toEventCard,
  toManageEvent,
  toPublicEvent,
  toPublicTicketType,
  type EventCardDto,
  type FullEvent,
  type ManageEventDto,
  type PublicEventDto,
} from "./events.dto.js";
import * as repo from "./events.repository.js";
import {
  EVENT_SLUG_MAX,
  type CreateEventBody,
  type ListEventsQuery,
  type MyEventsQuery,
  type UpdateEventBody,
} from "./events.schemas.js";

const log = logger.child({ module: "events" });
const TX_OPTS = { maxWait: 2_000, timeout: 5_000 } as const;
const MAX_DURATION_MS = 31 * 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => NotFound("Event");

// ───────────── shared checks ─────────────

function assertDates(startsAt: Date, endsAt: Date, startsChanged: boolean) {
  if (startsChanged && startsAt <= new Date()) {
    throw Unprocessable("INVALID_DATES", "The event must start in the future");
  }
  if (endsAt <= startsAt) throw Unprocessable("INVALID_DATES", "endsAt must be after startsAt");
  if (endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS) {
    throw Unprocessable("INVALID_DATES", "An event can last at most 31 days");
  }
}

function assertSeating(seatingType: string | undefined) {
  if (seatingType === "reserved") {
    throw Unprocessable(
      "RESERVED_SEATING_UNAVAILABLE",
      "Reserved seating needs venue seat maps, which aren't available yet",
    );
  }
}

async function assertCategory(categoryId: string, db: DbOrTx) {
  if (!(await db.category.findUnique({ where: { id: categoryId } }))) {
    throw Unprocessable("INVALID_CATEGORY", "Category not found");
  }
}

/** The organizer who owns the event. Others (even admins) get 404 for edits. */
async function findOwned(auth: AuthContext, id: string, db: DbOrTx) {
  const event = await db.event.findFirst({ where: { id, deletedAt: null } });
  if (!event || event.organizerId !== auth.userId) throw notFound();
  return event;
}

const isManager = (e: { organizerId: string }, auth?: AuthContext) =>
  !!auth && (auth.userId === e.organizerId || auth.role === "admin");

/** Drafts and private events are only visible to the owner and admins. */
function canView(e: FullEvent, auth?: AuthContext) {
  if (e.deletedAt) return false;
  if (isManager(e, auth)) return true;
  return e.status !== "draft" && e.visibility !== "private";
}

async function loadFull(id: string, db: DbOrTx = prisma): Promise<FullEvent> {
  const e = await repo.findFull({ id }, db);
  if (!e) throw notFound();
  return e;
}

// ───────────── create ─────────────

const suffix = () => randomBytes(3).toString("hex");

function slugCandidates(title: string, chosen?: string): string[] {
  if (chosen) return [chosen];
  const base = slugify(title)
    .slice(0, EVENT_SLUG_MAX - 7)
    .replace(/-+$/, "");
  if (base.length < 3) return [1, 2, 3].map(() => `event-${suffix()}`);
  return [base, `${base}-${suffix()}`, `${base}-${suffix()}`];
}

export async function create(
  auth: AuthContext,
  input: CreateEventBody,
  ip: string | null,
): Promise<ManageEventDto> {
  const organizer = await requireOrganizerProfile(auth.userId);
  assertSeating(input.seatingType);
  assertDates(input.startsAt, input.endsAt, true);
  if (input.mode !== "online" && !input.venueId) {
    throw Unprocessable("VENUE_REQUIRED", "In-person and hybrid events need a venue");
  }

  const candidates = slugCandidates(input.title, input.slug);
  for (const [i, slug] of candidates.entries()) {
    try {
      const id = await prisma.$transaction(async (tx) => {
        if (input.venueId) await requireUsableVenue(organizer.userId, input.venueId, tx);
        if (input.categoryId) await assertCategory(input.categoryId, tx);
        if (input.coverUploadId) {
          await requireReadyUpload(auth.userId, input.coverUploadId, "event_cover", tx);
        }
        const { slug: _slug, metadata, ...rest } = input;
        const event = await tx.event.create({
          data: { ...rest, slug, organizerId: organizer.userId, metadata: metadata ?? {} },
        });
        await writeAudit(
          {
            actorId: auth.userId,
            action: "event.created",
            entityType: "event",
            entityId: event.id,
            ip,
            diff: { title: event.title, slug },
          },
          tx,
        );
        return event.id;
      }, TX_OPTS);
      log.info({ eventId: id, organizerId: organizer.userId }, "event.created");
      return toManageEvent(await loadFull(id));
    } catch (err) {
      if (isUniqueViolation(err, "slug")) {
        if (i < candidates.length - 1) continue;
        throw Conflict("SLUG_TAKEN", "Another event already uses this URL");
      }
      throw err;
    }
  }
  throw Conflict("SLUG_TAKEN", "Another event already uses this URL");
}

// ───────────── read ─────────────

export type EventView =
  { manage: true; event: ManageEventDto } | { manage: false; event: PublicEventDto };

/** By id or slug. Owners/admins get the full management view (with version for If-Match). */
export async function getForViewer(idOrSlug: string, auth?: AuthContext): Promise<EventView> {
  const where: Prisma.EventWhereInput = UUID.test(idOrSlug)
    ? { id: idOrSlug }
    : { slug: idOrSlug.toLowerCase() };
  const e = await repo.findFull(where);
  if (!e || !canView(e, auth)) throw notFound();
  return isManager(e, auth)
    ? { manage: true, event: toManageEvent(e) }
    : { manage: false, event: toPublicEvent(e) };
}

/** Live stock per ticket type (short cache). */
export async function availability(id: string, auth?: AuthContext) {
  const e = await loadFull(id);
  if (!canView(e, auth)) throw notFound();
  return {
    eventId: e.id,
    status: e.status,
    ticketTypes: e.ticketTypes
      .filter((t) => t.isActive)
      .map((t) => {
        const { id: ticketTypeId, available, soldOut, onSale } = toPublicTicketType(t, e);
        return { ticketTypeId, available, soldOut, onSale };
      }),
  };
}

interface ListCursor {
  s: string;
  id: string;
}
const isListCursor = (v: unknown): v is ListCursor => {
  const o = v as Partial<ListCursor> | null;
  return (
    typeof o?.s === "string" &&
    !Number.isNaN(Date.parse(o.s)) &&
    typeof o.id === "string" &&
    UUID.test(o.id)
  );
};

export async function listPublic(query: ListEventsQuery): Promise<Page<EventCardDto>> {
  const { cursor, ...filter } = query;
  const after = cursor ? decodeCursor(cursor, isListCursor) : undefined;
  const ids = await repo.searchPublicIds(
    filter,
    after ? { startsAt: new Date(after.s), id: after.id } : undefined,
  );
  const byId = new Map((await repo.findManyFull(ids)).map((e) => [e.id, e]));
  const rows = ids.map((id) => byId.get(id)).filter((e): e is FullEvent => !!e);
  return toPage(rows, filter.limit, toEventCard, (e) => ({
    s: e.startsAt.toISOString(),
    id: e.id,
  }));
}

const isIdCursor = (v: unknown): v is { id: string } =>
  typeof (v as { id?: unknown } | null)?.id === "string" && UUID.test((v as { id: string }).id);

/** Organizer dashboard: own events, newest first (uuidv7 ids are time-ordered). */
export async function listMine(auth: AuthContext, query: MyEventsQuery) {
  await requireOrganizerProfile(auth.userId);
  const afterId = query.cursor ? decodeCursor(query.cursor, isIdCursor).id : undefined;
  const rows = (await prisma.event.findMany({
    where: {
      organizerId: auth.userId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(afterId ? { id: { lt: afterId } } : {}),
    },
    include: { category: true, venue: true, organizer: true, cover: true, ticketTypes: true },
    orderBy: { id: "desc" },
    take: query.limit + 1,
  })) as FullEvent[];
  return toPage(
    rows,
    query.limit,
    (e) => ({
      ...toEventCard(e),
      status: e.status,
      visibility: e.visibility,
      version: e.version,
      publishedAt: e.publishedAt?.toISOString() ?? null,
      ticketsSold: e.ticketTypes.reduce((n, t) => n + t.quantitySold, 0),
      ticketsTotal: e.ticketTypes.reduce((n, t) => n + t.quantityTotal, 0),
    }),
    (e) => ({ id: e.id }),
  );
}

// ───────────── update ─────────────

/**
 * Optimistic locking: `expectedVersion` comes from If-Match. Drafts can change anything;
 * published events keep their URL (slug) and seating type. Cancelled/completed are read-only.
 */
export async function update(
  auth: AuthContext,
  id: string,
  expectedVersion: number,
  input: UpdateEventBody,
  ip: string | null,
): Promise<ManageEventDto> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await findOwned(auth, id, tx);
      if (before.status === "cancelled" || before.status === "completed") {
        throw Conflict("EVENT_NOT_EDITABLE", `A ${before.status} event can't be edited`);
      }
      if (before.version !== expectedVersion) throw PreconditionFailed();

      const published = before.status === "published";
      if (published && input.slug !== undefined && input.slug !== before.slug) {
        throw Conflict("SLUG_LOCKED", "The URL of a published event can't change");
      }
      if (published && input.seatingType && input.seatingType !== before.seatingType) {
        throw Conflict("SEATING_LOCKED", "The seating type of a published event can't change");
      }
      assertSeating(input.seatingType);

      const startsAt = input.startsAt ?? before.startsAt;
      const endsAt = input.endsAt ?? before.endsAt;
      if (input.startsAt || input.endsAt) {
        assertDates(startsAt, endsAt, input.startsAt !== undefined);
      }
      const mode = input.mode ?? before.mode;
      const venueId = input.venueId !== undefined ? input.venueId : before.venueId;
      const onlineUrl = input.onlineUrl !== undefined ? input.onlineUrl : before.onlineUrl;
      if (mode !== "online" && !venueId) {
        throw Unprocessable("VENUE_REQUIRED", "In-person and hybrid events need a venue");
      }
      if (published && mode !== "in_person" && !onlineUrl) {
        throw Unprocessable("ONLINE_URL_REQUIRED", "Online and hybrid events need an online link");
      }
      if (input.venueId) await requireUsableVenue(before.organizerId, input.venueId, tx);
      if (input.categoryId) await assertCategory(input.categoryId, tx);
      if (input.coverUploadId) {
        await requireReadyUpload(auth.userId, input.coverUploadId, "event_cover", tx);
      }

      const { metadata, ...rest } = input;
      const { count } = await tx.event.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...rest,
          ...(metadata !== undefined ? { metadata } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw PreconditionFailed(); // someone saved in between

      await writeAudit(
        {
          actorId: auth.userId,
          action: "event.updated",
          entityType: "event",
          entityId: id,
          ip,
          diff: { fields: Object.keys(input), version: expectedVersion + 1 },
        },
        tx,
      );
    }, TX_OPTS);
  } catch (err) {
    if (isUniqueViolation(err, "slug")) {
      throw Conflict("SLUG_TAKEN", "Another event already uses this URL");
    }
    throw err;
  }
  return toManageEvent(await loadFull(id));
}

/** Only drafts can be deleted (soft delete). Published events are cancelled instead. */
export async function remove(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const e = await findOwned(auth, id, tx);
    if (e.status !== "draft") {
      throw Conflict("EVENT_NOT_DELETABLE", "Only drafts can be deleted; cancel the event instead");
    }
    await tx.event.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(
      { actorId: auth.userId, action: "event.deleted", entityType: "event", entityId: id, ip },
      tx,
    );
  }, TX_OPTS);
}

// ───────────── lifecycle ─────────────

/** draft → published. Checks the event is complete and the organizer is verified. */
export async function publish(
  auth: AuthContext,
  id: string,
  ip: string | null,
): Promise<ManageEventDto> {
  await prisma.$transaction(async (tx) => {
    // sequential reads: one connection inside a transaction can't run queries in parallel
    const e = await findOwned(auth, id, tx);
    const organizer = await tx.organizerProfile.findUniqueOrThrow({
      where: { userId: e.organizerId },
    });
    const venue = e.venueId ? await tx.venue.findUnique({ where: { id: e.venueId } }) : null;
    const activeTickets = await tx.ticketType.count({ where: { eventId: id, isActive: true } });
    if (organizer.verificationStatus !== "verified") {
      throw Forbidden(
        "ORGANIZER_NOT_VERIFIED",
        "Your organizer profile must be verified before you can publish events",
      );
    }
    if (e.status !== "draft") {
      throw Conflict("INVALID_STATE", `Only drafts can be published (this event is ${e.status})`);
    }

    const missing: string[] = [];
    if (e.startsAt <= new Date()) missing.push("startsAt (must be in the future)");
    if (!e.summary) missing.push("summary");
    if (!e.categoryId) missing.push("categoryId");
    if (e.mode !== "online" && (!venue || venue.deletedAt)) missing.push("venueId");
    if (e.mode !== "in_person" && !e.onlineUrl) missing.push("onlineUrl");
    if (activeTickets === 0) missing.push("ticketTypes (at least one active)");
    if (missing.length) {
      throw new AppError(422, "EVENT_INCOMPLETE", `Before publishing, add: ${missing.join(", ")}`, {
        missing,
      });
    }

    const { count } = await tx.event.updateMany({
      where: { id, status: "draft" },
      data: { status: "published", publishedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) throw Conflict("INVALID_STATE", "The event changed, reload and try again");
    await writeAudit(
      { actorId: auth.userId, action: "event.published", entityType: "event", entityId: id, ip },
      tx,
    );
  }, TX_OPTS);
  log.info({ eventId: id }, "event.published");
  return toManageEvent(await loadFull(id));
}

/**
 * published → cancelled, by the organizer or an admin.
 * When bookings exist, this will also enqueue refunds and notify ticket holders.
 */
export async function cancel(
  auth: AuthContext,
  id: string,
  reason: string,
  ip: string | null,
): Promise<ManageEventDto> {
  await prisma.$transaction(async (tx) => {
    const e = await tx.event.findFirst({ where: { id, deletedAt: null } });
    if (!e || !isManager(e, auth)) throw notFound();
    if (e.status !== "published") {
      throw Conflict(
        "INVALID_STATE",
        e.status === "draft"
          ? "Drafts aren't cancelled, delete them instead"
          : `This event is already ${e.status}`,
      );
    }
    await tx.event.update({
      where: { id },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: reason,
        version: { increment: 1 },
      },
    });
    await writeAudit(
      {
        actorId: auth.userId,
        action: auth.userId === e.organizerId ? "event.cancelled" : "admin.event_cancelled",
        entityType: "event",
        entityId: id,
        ip,
        diff: { reason },
      },
      tx,
    );
  }, TX_OPTS);
  log.info({ eventId: id, by: auth.userId }, "event.cancelled");
  return toManageEvent(await loadFull(id));
}

/** Maintenance job. */
export async function completeEndedEvents(): Promise<number> {
  const { count } = await repo.completeEndedEvents();
  if (count) log.info({ count }, "events.completed");
  return count;
}

// ───────────── used by ticket types ─────────────

export { canView, findOwned, isManager, loadFull };
