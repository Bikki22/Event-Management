import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { disconnectPrisma } from "./lib/prisma.js";
import { closeQueues } from "./lib/queue.js";
import { disconnectRedis } from "./lib/redis.js";
import { markShuttingDown } from "./modules/health/health.routes.js";

const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "api listening");
});

// 30 s request timeout + slowloris-resistant header/keep-alive timeouts
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

// ---- Graceful shutdown ----
const SHUTDOWN_TIMEOUT_MS = 25_000;
const DRAIN_DELAY_MS = env.NODE_ENV === "production" ? 5_000 : 0;
let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down");

  // hard deadline so a stuck connection can't block exit forever
  setTimeout(() => {
    logger.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  markShuttingDown(); // /health/ready → 503, LB drains us
  await new Promise((r) => setTimeout(r, DRAIN_DELAY_MS));

  server.close(async (err) => {
    if (err) logger.error({ err }, "error closing http server");
    await closeQueues().catch((e: unknown) => logger.error({ err: e }, "error closing queues"));
    await disconnectPrisma().catch((e: unknown) => logger.error({ err: e }, "error closing db"));
    await disconnectRedis();
    logger.info("shutdown complete");
    process.exit(err ? 1 : 0);
  });
  server.closeIdleConnections();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Unknown state is worse than a restart: log fatal and exit.
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled promise rejection");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  process.exit(1);
});
