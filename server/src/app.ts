import cookieParser from "cookie-parser";
import express, { Router, type Express } from "express";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestContext } from "./middleware/request-context.js";
import { applySecurity } from "./middleware/security.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { bookingsRouter, myBookingsRouter } from "./modules/bookings/bookings.routes.js";
import { eventsRouter, myEventsRouter } from "./modules/events/events.routes.js";
import { metricsMiddleware, metricsRouter } from "./middleware/metrics.js";
import {
  bookingPaymentsRouter,
  paymentsRouter,
  webhooksRouter,
} from "./modules/payments/payments.routes.js";
import {
  eventPromoCodesRouter,
  promoCodesRouter,
} from "./modules/promo-codes/promo-codes.routes.js";
import {
  attendeesRouter,
  checkInsRouter,
  exportsRouter,
  myStaffEventsRouter,
  myTicketsRouter,
  staffRouter,
  ticketsRouter,
} from "./modules/tickets/tickets.routes.js";
import { uploadsRouter } from "./modules/uploads/uploads.routes.js";
import { venuesRouter } from "./modules/venues/venues.routes.js";
import { categoriesRouter } from "./modules/categories/categories.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { meRouter } from "./modules/users/users.routes.js";
import { myOrganizerRouter, organizersRouter } from "./modules/organizers/organizers.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";

/** Builds the Express app (used by server.ts and by tests). */
export function buildApp(): Express {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(requestContext);
  app.use(metricsMiddleware);
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
  // webhooks verify signatures over the raw bytes: mount before express.json() parses them
  app.use("/api/v1/webhooks", webhooksRouter);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Infra routes (unversioned)
  app.use("/health", healthRouter);
  app.use("/metrics", metricsRouter);

  // Versioned API. Module routers are mounted here as they are built.
  const api = Router();
  api.get("/", (_req, res) => {
    res.json({ name: "Event Management System API", version: "v1" });
  });
  api.use("/auth", authRouter);
  api.use("/me/organizer-profile", myOrganizerRouter); // before /me
  api.use("/me/events", myEventsRouter); // before /me
  api.use("/me/bookings", myBookingsRouter); // before /me
  api.use("/me/tickets", myTicketsRouter); // before /me
  api.use("/me/staff-events", myStaffEventsRouter); // before /me
  api.use("/me", meRouter);
  api.use("/organizers", organizersRouter);
  api.use("/venues", venuesRouter);
  api.use("/events/:id/check-ins", checkInsRouter); // before /events
  api.use("/events/:id/staff", staffRouter); // before /events
  api.use("/events/:id/attendees", attendeesRouter); // before /events
  api.use("/events/:id/promo-codes", eventPromoCodesRouter); // before /events
  api.use("/events", eventsRouter);
  api.use("/bookings", bookingPaymentsRouter); // /:id/payments, /:id/refunds
  api.use("/bookings", bookingsRouter);
  api.use("/payments", paymentsRouter);
  api.use("/promo-codes", promoCodesRouter);
  api.use("/exports", exportsRouter);
  api.use("/tickets", ticketsRouter);
  api.use("/uploads", uploadsRouter);
  api.use("/categories", categoriesRouter);
  api.use("/admin", adminRouter);
  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler); // must be last
  return app;
}
