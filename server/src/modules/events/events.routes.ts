import { Router, type Response } from "express";
import { requireIfMatch, setVersionEtag } from "../../lib/etag.js";
import { authenticate, optionalAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  cancelEventBody,
  createEventBody,
  createTicketTypeBody,
  eventIdParams,
  eventRefParams,
  listEventsQuery,
  myEventsQuery,
  ticketTypeParams,
  updateEventBody,
  updateTicketTypeBody,
  type CreateEventBody,
  type CreateTicketTypeBody,
  type ListEventsQuery,
  type MyEventsQuery,
  type UpdateEventBody,
  type UpdateTicketTypeBody,
} from "./events.schemas.js";
import * as events from "./events.service.js";
import * as ticketTypes from "./ticket-types.service.js";

const PUBLIC_CACHE = "public, max-age=30, stale-while-revalidate=60";
const PRIVATE = "private, no-store";

/** Owner responses: never cached, and carry the version for the next If-Match. */
const manageResponse = (res: Response, version: number) => {
  res.setHeader("Cache-Control", PRIVATE);
  setVersionEtag(res, version);
};

const idParam = (p: unknown) => (p as { id: string }).id;

/** Mounted at /api/v1/events */
export const eventsRouter = Router();

// ───────────── public reads ─────────────

eventsRouter.get("/", validate({ query: listEventsQuery }), async (req, res) => {
  res.setHeader("Cache-Control", PUBLIC_CACHE);
  res.json(await events.listPublic(req.query as unknown as ListEventsQuery));
});

eventsRouter.get(
  "/:idOrSlug",
  optionalAuth,
  validate({ params: eventRefParams }),
  async (req, res) => {
    const view = await events.getForViewer((req.params as { idOrSlug: string }).idOrSlug, req.auth);
    if (view.manage) manageResponse(res, view.event.version);
    else res.setHeader("Cache-Control", PUBLIC_CACHE);
    res.json({ event: view.event });
  },
);

eventsRouter.get(
  "/:id/availability",
  optionalAuth,
  validate({ params: eventIdParams }),
  async (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3");
    res.json(await events.availability(idParam(req.params), req.auth));
  },
);

// ───────────── organizer writes ─────────────

eventsRouter.post("/", authenticate, validate({ body: createEventBody }), async (req, res) => {
  const event = await events.create(req.auth!, req.body as CreateEventBody, req.ip ?? null);
  manageResponse(res, event.version);
  res.status(201).location(`/api/v1/events/${event.id}`).json({ event });
});

eventsRouter.patch(
  "/:id",
  authenticate,
  validate({ params: eventIdParams, body: updateEventBody }),
  async (req, res) => {
    const event = await events.update(
      req.auth!,
      idParam(req.params),
      requireIfMatch(req),
      req.body as UpdateEventBody,
      req.ip ?? null,
    );
    manageResponse(res, event.version);
    res.json({ event });
  },
);

eventsRouter.delete("/:id", authenticate, validate({ params: eventIdParams }), async (req, res) => {
  await events.remove(req.auth!, idParam(req.params), req.ip ?? null);
  res.status(204).end();
});

eventsRouter.post(
  "/:id/publish",
  authenticate,
  validate({ params: eventIdParams }),
  async (req, res) => {
    const event = await events.publish(req.auth!, idParam(req.params), req.ip ?? null);
    manageResponse(res, event.version);
    res.json({ event });
  },
);

eventsRouter.post(
  "/:id/cancel",
  authenticate,
  validate({ params: eventIdParams, body: cancelEventBody }),
  async (req, res) => {
    const event = await events.cancel(
      req.auth!,
      idParam(req.params),
      (req.body as { reason: string }).reason,
      req.ip ?? null,
    );
    manageResponse(res, event.version);
    res.json({ event });
  },
);

// ───────────── ticket types ─────────────

eventsRouter.get(
  "/:id/ticket-types",
  optionalAuth,
  validate({ params: eventIdParams }),
  async (req, res) => {
    res.setHeader("Cache-Control", req.auth ? PRIVATE : PUBLIC_CACHE);
    res.json({ data: await ticketTypes.list(idParam(req.params), req.auth) });
  },
);

eventsRouter.post(
  "/:id/ticket-types",
  authenticate,
  validate({ params: eventIdParams, body: createTicketTypeBody }),
  async (req, res) => {
    const ticketType = await ticketTypes.create(
      req.auth!,
      idParam(req.params),
      req.body as CreateTicketTypeBody,
      req.ip ?? null,
    );
    manageResponse(res, ticketType.version);
    res.status(201).json({ ticketType });
  },
);

eventsRouter.patch(
  "/:id/ticket-types/:ttId",
  authenticate,
  validate({ params: ticketTypeParams, body: updateTicketTypeBody }),
  async (req, res) => {
    const { id, ttId } = req.params as { id: string; ttId: string };
    const ticketType = await ticketTypes.update(
      req.auth!,
      id,
      ttId,
      requireIfMatch(req),
      req.body as UpdateTicketTypeBody,
      req.ip ?? null,
    );
    manageResponse(res, ticketType.version);
    res.json({ ticketType });
  },
);

eventsRouter.delete(
  "/:id/ticket-types/:ttId",
  authenticate,
  validate({ params: ticketTypeParams }),
  async (req, res) => {
    const { id, ttId } = req.params as { id: string; ttId: string };
    await ticketTypes.remove(req.auth!, id, ttId, req.ip ?? null);
    res.status(204).end();
  },
);

/** Mounted at /api/v1/me/events (organizer dashboard). */
export const myEventsRouter = Router();

myEventsRouter.get("/", authenticate, validate({ query: myEventsQuery }), async (req, res) => {
  res.setHeader("Cache-Control", PRIVATE);
  res.json(await events.listMine(req.auth!, req.query as unknown as MyEventsQuery));
});
