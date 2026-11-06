import type { Prisma } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import {
  BadRequest,
  Conflict,
  isForeignKeyViolation,
  isUniqueViolation,
  NotFound,
  Unprocessable,
} from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { slugify } from "../../lib/slug.js";
import { buildTree, toCategoryDto, type CategoryDto, type CategoryNode } from "./categories.dto.js";
import * as repo from "./categories.repository.js";
import type { CreateCategoryBody, UpdateCategoryBody } from "./categories.schemas.js";

const log = logger.child({ module: "categories" });

// ───────────── public reads (cached) ─────────────

const CACHE_KEY = "cat:all";
const CACHE_TTL_SECONDS = 3_600;

/**
 * Category tree, cache-aside in Redis (1 h, dropped on every admin change).
 * The cache is only an optimisation: if Redis is down we read from Postgres.
 */
export async function listTree(): Promise<CategoryNode[]> {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as CategoryNode[];
  } catch (err) {
    log.warn({ err }, "category cache read failed");
  }

  const tree = buildTree(await repo.listAll());
  try {
    await redis.set(CACHE_KEY, JSON.stringify(tree), "EX", CACHE_TTL_SECONDS);
  } catch (err) {
    log.warn({ err }, "category cache write failed");
  }
  return tree;
}

/** One category by slug, with its parent (sub-category) or its children (top-level). */
export async function getBySlug(slug: string) {
  const tree = await listTree();
  for (const root of tree) {
    if (root.slug === slug) return { ...root, parent: null };
    const child = root.children.find((c) => c.slug === slug);
    if (child) {
      const { children: _children, ...parent } = root;
      return { ...child, parent, children: [] };
    }
  }
  throw NotFound("Category");
}

async function invalidateCache(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
  } catch (err) {
    // worst case the public list is stale until the TTL runs out
    log.error({ err }, "category cache invalidation failed");
  }
}

// ───────────── admin writes ─────────────

const asJson = (dto: CategoryDto) => dto as unknown as Prisma.InputJsonObject;

/** Only two levels: the parent must exist and be top-level itself. */
async function assertValidParent(parentId: string, db: DbOrTx): Promise<void> {
  const parent = await repo.findById(parentId, db);
  if (!parent) throw Unprocessable("INVALID_PARENT", "Parent category does not exist");
  if (parent.parentId !== null) {
    throw Unprocessable("MAX_DEPTH", "Sub-categories can't have their own sub-categories");
  }
}

/** Unique violations → a clear 409 telling the admin which field clashed. */
function rethrowDuplicate(err: unknown): never {
  if (isUniqueViolation(err, "slug")) {
    throw Conflict("SLUG_TAKEN", "Another category already uses this slug");
  }
  if (isUniqueViolation(err, "name")) {
    throw Conflict("NAME_TAKEN", "Another category already has this name");
  }
  throw err;
}

export async function create(
  actorId: string,
  input: CreateCategoryBody,
  ip: string | null,
): Promise<CategoryDto> {
  const slug = input.slug ?? slugify(input.name);
  if (!slug) throw BadRequest("SLUG_REQUIRED", "Couldn't build a slug from the name, send one");

  const category = await prisma
    .$transaction(async (tx) => {
      if (input.parentId) await assertValidParent(input.parentId, tx);
      const created = await repo.create(
        {
          name: input.name,
          slug,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
        tx,
      );
      await writeAudit(
        {
          actorId,
          action: "admin.category_created",
          entityType: "category",
          entityId: created.id,
          ip,
          diff: { after: asJson(toCategoryDto(created)) },
        },
        tx,
      );
      return created;
    })
    .catch(rethrowDuplicate);

  await invalidateCache();
  log.info({ actorId, categoryId: category.id, slug }, "categories.created");
  return toCategoryDto(category);
}

export async function update(
  actorId: string,
  id: string,
  input: UpdateCategoryBody,
  ip: string | null,
): Promise<CategoryDto> {
  const category = await prisma
    .$transaction(async (tx) => {
      const before = await repo.findById(id, tx);
      if (!before) throw NotFound("Category");

      if (input.parentId) {
        if (input.parentId === id) {
          throw Unprocessable("INVALID_PARENT", "A category can't be its own parent");
        }
        if (before._count.children > 0) {
          throw Unprocessable(
            "MAX_DEPTH",
            "This category has sub-categories, so it can't become a sub-category",
          );
        }
        await assertValidParent(input.parentId, tx);
      }

      const after = await repo.update(
        id,
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
        tx,
      );
      await writeAudit(
        {
          actorId,
          action: "admin.category_updated",
          entityType: "category",
          entityId: id,
          ip,
          diff: { before: asJson(toCategoryDto(before)), after: asJson(toCategoryDto(after)) },
        },
        tx,
      );
      return after;
    })
    .catch(rethrowDuplicate);

  await invalidateCache();
  log.info({ actorId, categoryId: id }, "categories.updated");
  return toCategoryDto(category);
}

export async function remove(actorId: string, id: string, ip: string | null): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await repo.findById(id, tx);
      if (!before) throw NotFound("Category");
      if (before._count.children > 0) {
        throw Conflict("CATEGORY_HAS_CHILDREN", "Delete or move its sub-categories first");
      }
      await repo.remove(id, tx);
      await writeAudit(
        {
          actorId,
          action: "admin.category_deleted",
          entityType: "category",
          entityId: id,
          ip,
          diff: { before: asJson(toCategoryDto(before)) },
        },
        tx,
      );
    });
  } catch (err) {
    // once the events module exists, events.category_id references categories
    if (isForeignKeyViolation(err)) {
      throw Conflict("CATEGORY_IN_USE", "Events still use this category, move them first");
    }
    throw err;
  }

  await invalidateCache();
  log.info({ actorId, categoryId: id }, "categories.deleted");
}
