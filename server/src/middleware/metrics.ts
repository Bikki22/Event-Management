import { isIP } from "node:net";
import { Router, type RequestHandler } from "express";
import { env } from "../config/env.js";
import { safeEqual } from "../lib/crypto.js";
import { httpDuration, registry } from "../lib/metrics.js";

/**
 * Request latency histogram. The route label is the matched Express pattern
 * (e.g. /api/v1/events/:id), never the raw URL, so label cardinality stays bounded.
 */
export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    const pattern = req.route?.path as string | undefined;
    const route = pattern ? `${req.baseUrl}${pattern === "/" ? "" : pattern}` || "/" : "unmatched";
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
};

const isPrivate = (ip: string | undefined) => {
  if (!ip) return false;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return ip === "::1" || ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd");
};

/** GET /metrics: with METRICS_TOKEN set, a matching Bearer token; otherwise private networks only. */
export const metricsRouter = Router();
metricsRouter.get("/", async (req, res) => {
  const allowed = env.METRICS_TOKEN
    ? safeEqual(req.get("authorization") ?? "", `Bearer ${env.METRICS_TOKEN}`)
    : isPrivate(req.socket.remoteAddress);
  if (!allowed) {
    res.status(404).end(); // don't advertise the endpoint
    return;
  }
  res.setHeader("Content-Type", registry.contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(await registry.metrics());
});
