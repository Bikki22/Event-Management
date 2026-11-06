import { randomBytes } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import { encryptJson } from "../../lib/encryption.js";
import { AppError, Conflict, isUniqueViolation, NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { decodeCursor, toPage, type Page } from "../../lib/pagination.js";
import { prisma } from "../../lib/prisma.js";
import { SLUG_MAX, slugify } from "../../lib/slug.js";
import { invalidateUserState } from "../auth/session-state.js";
import { dispatch, queueEmail } from "../notifications/notifications.service.js";
import {
  payoutAad,
  toAdminDto,
  toProfileDto,
  toPublicDto,
  type AdminOrganizerDto,
  type OrganizerProfileDto,
  type PublicOrganizerDto,
} from "./organizers.dto.js";
import * as repo from "./organizers.repository.js";
import type {
  AdminListOrganizersQuery,
  CreateProfileBody,
  PayoutBody,
  ReviewBody,
  UpdateProfileBody,
} from "./organizers.schemas.js";

const log = logger.child({ module: "organizers" });
const TX_OPTS = { maxWait: 2_000, timeout: 5_000 } as const;

const profileNotFound = () =>
  new AppError(404, "ORGANIZER_PROFILE_NOT_FOUND", "You don't have an organizer profile yet");
const slugTaken = () => Conflict("SLUG_TAKEN", "Another organizer already uses this URL");

// ───────────── become an organizer ─────────────

const suffix = () => randomBytes(3).toString("hex"); // 6 chars

/** Slug candidates: the chosen/generated one first, then with a random suffix. */
function slugCandidates(input: CreateProfileBody): string[] {
  if (input.slug) return [input.slug]; // user picked it: a clash is their call to resolve
  const base = slugify(input.orgName)
    .slice(0, SLUG_MAX - 7)
    .replace(/-+$/, "");
  // non-latin names (e.g. Devanagari) slugify to "": fall back to a neutral prefix
  if (base.length < 3) return [1, 2, 3].map(() => `organizer-${suffix()}`);
  return [base, `${base}-${suffix()}`, `${base}-${suffix()}`];
}

/**
 * Creates the profile and promotes the user to `organizer` (admins keep their role).
 * Starts in `pending`; an admin verifies it.
 */
export async function becomeOrganizer(
  userId: string,
  input: CreateProfileBody,
  ip: string | null,
): Promise<OrganizerProfileDto> {
  const candidates = slugCandidates(input);

  for (const [i, slug] of candidates.entries()) {
    try {
      const profile = await prisma.$transaction(async (tx) => {
        if (await repo.findByUserId(userId, tx)) {
          throw Conflict("ALREADY_ORGANIZER", "You already have an organizer profile");
        }
        const created = await repo.create(
          {
            userId,
            orgName: input.orgName,
            slug,
            bio: input.bio ?? null,
            website: input.website ?? null,
            logoUrl: input.logoUrl ?? null,
            createdAt: new Date(), // ms precision, see list cursor
          },
          tx,
        );
        await tx.user.updateMany({
          where: { id: userId, role: "attendee" },
          data: { role: "organizer" },
        });
        await writeAudit(
          {
            actorId: userId,
            action: "organizer.profile_created",
            entityType: "organizer_profile",
            entityId: userId,
            ip,
            diff: { orgName: created.orgName, slug: created.slug },
          },
          tx,
        );
        return created;
      }, TX_OPTS);

      await invalidateUserState(userId); // new role applies on the next request
      log.info({ userId, slug }, "organizer.profile_created");
      return toProfileDto(profile);
    } catch (err) {
      // double submit: the primary key (user_id) already exists
      if (isUniqueViolation(err, "user_id")) {
        throw Conflict("ALREADY_ORGANIZER", "You already have an organizer profile");
      }
      if (isUniqueViolation(err, "slug")) {
        if (i < candidates.length - 1) continue; // try the next generated slug
        throw slugTaken();
      }
      throw err;
    }
  }
  throw slugTaken(); // unreachable
}

// ───────────── own profile ─────────────

export async function getMine(userId: string): Promise<OrganizerProfileDto> {
  const profile = await repo.findByUserId(userId);
  if (!profile) throw profileNotFound();
  return toProfileDto(profile);
}

/**
 * Editing a rejected profile resubmits it for review. Renaming a verified organization
 * also sends it back to review (stops a verified badge being reused under a new name).
 */
export async function updateMine(
  userId: string,
  input: UpdateProfileBody,
  ip: string | null,
): Promise<OrganizerProfileDto> {
  try {
    const profile = await prisma.$transaction(async (tx) => {
      const before = await repo.findByUserId(userId, tx);
      if (!before) throw profileNotFound();

      const renamed = input.orgName !== undefined && input.orgName !== before.orgName;
      const backToReview =
        before.verificationStatus === "rejected" ||
        (before.verificationStatus === "verified" && renamed);

      const after = await repo.update(
        userId,
        {
          ...(input.orgName !== undefined ? { orgName: input.orgName } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.website !== undefined ? { website: input.website } : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          ...(backToReview
            ? { verificationStatus: "pending", reviewNote: null, reviewedAt: null }
            : {}),
        },
        tx,
      );
      await writeAudit(
        {
          actorId: userId,
          action: "organizer.profile_updated",
          entityType: "organizer_profile",
          entityId: userId,
          ip,
          diff: {
            fields: Object.keys(input),
            ...(backToReview
              ? { verificationStatus: { from: before.verificationStatus, to: "pending" } }
              : {}),
          },
        },
        tx,
      );
      return after;
    }, TX_OPTS);
    return toProfileDto(profile);
  } catch (err) {
    if (isUniqueViolation(err, "slug")) throw slugTaken();
    throw err;
  }
}

/** Stores payout details encrypted (AES-256-GCM, bound to this user). Replaces any previous ones. */
export async function setPayout(
  userId: string,
  input: PayoutBody,
  ip: string | null,
): Promise<OrganizerProfileDto> {
  const profile = await prisma.$transaction(async (tx) => {
    if (!(await repo.findByUserId(userId, tx))) throw profileNotFound();
    const updated = await repo.update(
      userId,
      { payoutMethod: input.method, payoutDetails: { ...encryptJson(input, payoutAad(userId)) } },
      tx,
    );
    // never log or audit the details themselves
    await writeAudit(
      {
        actorId: userId,
        action: "organizer.payout_updated",
        entityType: "organizer_profile",
        entityId: userId,
        ip,
        diff: { method: input.method },
      },
      tx,
    );
    return updated;
  }, TX_OPTS);
  log.info({ userId, method: input.method }, "organizer.payout_updated");
  return toProfileDto(profile);
}

export async function removePayout(userId: string, ip: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (!(await repo.findByUserId(userId, tx))) throw profileNotFound();
    await repo.update(userId, { payoutMethod: null, payoutDetails: Prisma.DbNull }, tx);
    await writeAudit(
      {
        actorId: userId,
        action: "organizer.payout_removed",
        entityType: "organizer_profile",
        entityId: userId,
        ip,
      },
      tx,
    );
  }, TX_OPTS);
}

// ───────────── public ─────────────

/** Rejected organizers and suspended/deleted owners are hidden (404, not 403). */
export async function getPublic(slug: string): Promise<PublicOrganizerDto> {
  const profile = await repo.findBySlugWithOwnerStatus(slug);
  if (!profile || profile.verificationStatus === "rejected" || profile.user.status !== "active") {
    throw NotFound("Organizer");
  }
  return toPublicDto(profile);
}

// ───────────── admin ─────────────

interface ListCursor {
  c: string;
  id: string;
}
const isListCursor = (v: unknown): v is ListCursor => {
  const o = v as Partial<ListCursor> | null;
  return (
    typeof o?.c === "string" &&
    !Number.isNaN(Date.parse(o.c)) &&
    typeof o.id === "string" &&
    /^[0-9a-f-]{36}$/i.test(o.id)
  );
};

export async function adminList(query: AdminListOrganizersQuery): Promise<Page<AdminOrganizerDto>> {
  const { cursor, ...filter } = query;
  const after = cursor ? decodeCursor(cursor, isListCursor) : undefined;
  const rows = await repo.list(
    filter,
    after ? { createdAt: new Date(after.c), userId: after.id } : undefined,
  );
  return toPage(rows, filter.limit, toAdminDto, (p) => ({
    c: p.createdAt.toISOString(),
    id: p.userId,
  }));
}

export async function adminGet(userId: string): Promise<AdminOrganizerDto> {
  const profile = await repo.findByUserIdWithUser(userId);
  if (!profile) throw NotFound("Organizer");
  return toAdminDto(profile);
}

/** Verify or reject a profile. Audited, and the organizer gets an email. */
export async function adminReview(
  actorId: string,
  userId: string,
  input: ReviewBody,
  ip: string | null,
): Promise<AdminOrganizerDto> {
  const { profile, notificationId } = await prisma.$transaction(async (tx) => {
    const before = await repo.findByUserIdWithUser(userId, tx);
    if (!before) throw NotFound("Organizer");

    await repo.update(
      userId,
      {
        verificationStatus: input.status,
        reviewNote: input.note ?? null,
        reviewedAt: new Date(),
      },
      tx,
    );
    const profile = (await repo.findByUserIdWithUser(userId, tx))!;

    await writeAudit(
      {
        actorId,
        action:
          input.status === "verified" ? "admin.organizer_verified" : "admin.organizer_rejected",
        entityType: "organizer_profile",
        entityId: userId,
        ip,
        diff: {
          from: before.verificationStatus,
          to: input.status,
          ...(input.note ? { note: input.note } : {}),
        },
      },
      tx,
    );

    const notificationId =
      input.status === "verified"
        ? await queueEmail(tx, {
            userId,
            to: profile.user.email,
            type: "organizer.verified",
            payload: { name: profile.user.fullName, orgName: profile.orgName },
          })
        : await queueEmail(tx, {
            userId,
            to: profile.user.email,
            type: "organizer.rejected",
            payload: {
              name: profile.user.fullName,
              orgName: profile.orgName,
              note: input.note!,
            },
          });
    return { profile, notificationId };
  }, TX_OPTS);

  await dispatch([notificationId]);
  log.info({ actorId, userId, status: input.status }, "organizer.reviewed");
  return toAdminDto(profile);
}
