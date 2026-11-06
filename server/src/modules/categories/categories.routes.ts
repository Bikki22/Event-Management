import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import {
  categoryIdParams,
  categorySlugParams,
  createCategoryBody,
  updateCategoryBody,
  type CreateCategoryBody,
  type UpdateCategoryBody,
} from "./categories.schemas.js";
import * as categories from "./categories.service.js";

/** Mounted at /api/v1/categories (public). */
export const categoriesRouter = Router();

// Rarely changes: browsers/CDN may keep it 5 min (Express adds an ETag for cheap revalidation).
categoriesRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  next();
});

categoriesRouter.get("/", async (_req, res) => {
  res.json({ data: await categories.listTree() });
});

categoriesRouter.get("/:slug", validate({ params: categorySlugParams }), async (req, res) => {
  res.json({ category: await categories.getBySlug((req.params as { slug: string }).slug) });
});

/** Mounted at /api/v1/admin/categories. The admin router enforces authenticate + requireRole("admin"). */
export const adminCategoriesRouter = Router();

adminCategoriesRouter.post("/", validate({ body: createCategoryBody }), async (req, res) => {
  const category = await categories.create(
    req.auth!.userId,
    req.body as CreateCategoryBody,
    req.ip ?? null,
  );
  res.status(201).location(`/api/v1/categories/${category.slug}`).json({ category });
});

adminCategoriesRouter.patch(
  "/:id",
  validate({ params: categoryIdParams, body: updateCategoryBody }),
  async (req, res) => {
    const category = await categories.update(
      req.auth!.userId,
      (req.params as { id: string }).id,
      req.body as UpdateCategoryBody,
      req.ip ?? null,
    );
    res.json({ category });
  },
);

adminCategoriesRouter.delete("/:id", validate({ params: categoryIdParams }), async (req, res) => {
  await categories.remove(req.auth!.userId, (req.params as { id: string }).id, req.ip ?? null);
  res.status(204).end();
});
