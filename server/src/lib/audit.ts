import type { Prisma } from "../generated/prisma/client.js";
import { prisma, type DbOrTx } from "./prisma.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  diff?: Prisma.InputJsonValue;
}

/** Append-only audit record. Pass the transaction client so it commits with the change. */
export const writeAudit = (entry: AuditEntry, db: DbOrTx = prisma) =>
  db.auditLog.create({ data: entry, select: { id: true } });
