import { z } from "zod";
import { SLUG_MAX, SLUG_PATTERN } from "../../lib/slug.js";

const name = z.string().trim().min(1, { error: "Name is required" }).max(60);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .max(SLUG_MAX)
  .regex(SLUG_PATTERN, { error: "Use lowercase letters, numbers and single hyphens" });
const sortOrder = z.number().int().min(0).max(10_000);

export const createCategoryBody = z
  .object({
    name,
    slug: slug.optional(), // generated from name when omitted
    parentId: z.uuid().nullable().optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict();

export const updateCategoryBody = z
  .object({
    name: name.optional(),
    slug: slug.optional(),
    parentId: z.uuid().nullable().optional(), // null moves it to the top level
    sortOrder: sortOrder.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Provide at least one field to update" });

export const categoryIdParams = z.object({ id: z.uuid() });
export const categorySlugParams = z.object({ slug: z.string().trim().toLowerCase().max(SLUG_MAX) });

export type CreateCategoryBody = z.infer<typeof createCategoryBody>;
export type UpdateCategoryBody = z.infer<typeof updateCategoryBody>;
