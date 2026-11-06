import cors from "cors";
import type { Express } from "express";
import helmet from "helmet";
import { env } from "../config/env.js";
import { byIp, limiter } from "./rate-limit.js";

export function applySecurity(app: Express): void {
  // JSON-only API: lock CSP down completely
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        // non-browser clients (curl, server-to-server) send no Origin
        if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Idempotency-Key",
        "If-Match",
      ],
      exposedHeaders: [
        "x-request-id",
        "etag",
        "location",
        "retry-after",
        "ratelimit",
        "ratelimit-policy",
      ],
      maxAge: 600,
    }),
  );

  // Global per-IP limit, shared across replicas via Redis. Fails open: reads stay up if Redis is down.
  app.use(
    limiter({
      name: "global-ip",
      windowMs: 60_000,
      limit: 300,
      key: (req) => (req.path.startsWith("/health") ? undefined : byIp(req)),
      failClosed: false,
    }),
  );
}
