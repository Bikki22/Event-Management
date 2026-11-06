import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "prisma" });

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL, // pooled URL (PgBouncer in prod)
  max: env.DB_POOL_MAX,
  statement_timeout: env.PROCESS_TYPE === "api" ? 5_000 : 30_000,
  idle_in_transaction_session_timeout: 10_000,
});

const base = new PrismaClient({ adapter });

// Slow-query logging; request context is attached by the logger mixin.
export const prisma = base.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      const start = performance.now();
      try {
        return await query(args);
      } finally {
        const ms = performance.now() - start;
        if (ms > 200) log.warn({ model, operation, ms: Math.round(ms) }, "slow query");
      }
    },
  },
});

export type Db = typeof prisma;
/** Interactive-transaction client. Repositories accept `tx: Tx = prisma` so services can compose them. */
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export const disconnectPrisma = () => base.$disconnect();
