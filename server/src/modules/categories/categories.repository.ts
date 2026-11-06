import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";

export const listAll = (db: DbOrTx = prisma) =>
  db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });

export const findById = (id: string, db: DbOrTx = prisma) =>
  db.category.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });

export const create = (data: Prisma.CategoryUncheckedCreateInput, db: DbOrTx = prisma) =>
  db.category.create({ data });

export const update = (
  id: string,
  data: Prisma.CategoryUncheckedUpdateInput,
  db: DbOrTx = prisma,
) => db.category.update({ where: { id }, data });

export const remove = (id: string, db: DbOrTx = prisma) => db.category.delete({ where: { id } });
