import type { Category } from "../../generated/prisma/client.js";

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
}

export interface CategoryNode extends CategoryDto {
  children: CategoryDto[];
}

export const toCategoryDto = (c: Category): CategoryDto => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  parentId: c.parentId,
  sortOrder: c.sortOrder,
});

/** Flat rows (already sorted) → top-level categories with their sub-categories. */
export function buildTree(rows: Category[]): CategoryNode[] {
  const roots = rows
    .filter((c) => c.parentId === null)
    .map((c) => ({ ...toCategoryDto(c), children: [] as CategoryDto[] }));
  const byId = new Map(roots.map((r) => [r.id, r]));
  for (const c of rows) {
    if (c.parentId) byId.get(c.parentId)?.children.push(toCategoryDto(c));
  }
  return roots;
}
