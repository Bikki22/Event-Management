import cookieParser from "cookie-parser";
import express, { Router, type Express } from "express";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestContext } from "./middleware/request-context.js";
import { applySecurity } from "./middleware/security.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { categoriesRouter } from "./modules/categories/categories.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { meRouter } from "./modules/users/users.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";

/** Builds the Express app (used by server.ts and by tests). */
export function buildApp(): Express {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => res.getHeader("x-request-id") as string,
      autoLogging: {
        ignore: (req) => req.url?.startsWith("/health") === true || req.url === "/metrics",
      },
    }),
  );

  applySecurity(app);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Infra routes (unversioned)
  app.use("/health", healthRouter);

  // Versioned API. Module routers are mounted here as they are built.
  const api = Router();
  api.get("/", (_req, res) => {
    res.json({ name: "Event Management System API", version: "v1" });
  });
  api.use("/auth", authRouter);
  api.use("/me", meRouter);
  api.use("/categories", categoriesRouter);
  api.use("/admin", adminRouter);
  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler); // must be last
  return app;
}
