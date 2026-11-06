import type { ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "redis" });

/** Shared client for cache, rate limits and session revocation. Commands time out after 1 s. */
export const redis = new Redis(env.REDIS_URL, {
  commandTimeout: 1_000,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
  lazyConnect: false,
});
redis.on("error", (err) => log.error({ err }, "redis error"));

/**
 * BullMQ needs its own connections with `maxRetriesPerRequest: null`
 * (blocking commands must not time out). Pass these options, not the shared client.
 */
export const bullConnection: ConnectionOptions = (() => {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
})();

export const disconnectRedis = async () => {
  await redis.quit().catch(() => redis.disconnect());
};
