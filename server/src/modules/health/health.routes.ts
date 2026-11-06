import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";

let shuttingDown = false;
/** Called on SIGTERM so the load balancer stops routing traffic here. */
export const markShuttingDown = () => {
  shuttingDown = true;
};

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms).unref()),
  ]);

async function check(fn: () => Promise<unknown>): Promise<"ok" | "fail"> {
  try {
    await withTimeout(fn(), 1_000);
    return "ok";
  } catch {
    return "fail";
  }
}

export const healthRouter = Router();

// Liveness: process is up. No dependency checks.
healthRouter.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

// Readiness: can we serve traffic? Postgres SELECT 1 + Redis PING, 1 s timeout each.
healthRouter.get("/ready", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  const [db, cache] = await Promise.all([
    check(() => prisma.$queryRaw`SELECT 1`),
    check(() => redis.ping()),
  ]);
  const ok = db === "ok" && cache === "ok";
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", checks: { db, redis: cache } });
});
