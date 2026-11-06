import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { byUser, limiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import * as checkins from "./checkins.service.js";
import {
  addStaffBody,
  checkInBody,
  eventParams,
  holderBody,
  myTicketsQuery,
  staffParams,
  ticketIdParams,
  type AddStaffBody,
  type HolderBody,
  type MyTicketsQuery,
} from "./tickets.schemas.js";
import * as tickets from "./tickets.service.js";

const privateNoStore = Router();
privateNoStore.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

const idOf = (p: unknown) => (p as { id: string }).id;

/** Mounted at /api/v1/tickets */
export const ticketsRouter = Router();
ticketsRouter.use(privateNoStore, authenticate);

ticketsRouter.get("/:id", validate({ params: ticketIdParams }), async (req, res) => {
  res.json({ ticket: await tickets.get(req.auth!.userId, idOf(req.params)) });
});

ticketsRouter.patch(
  "/:id/holder",
  validate({ params: ticketIdParams, body: holderBody }),
  async (req, res) => {
    const ticket = await tickets.setHolder(
      req.auth!.userId,
      idOf(req.params),
      req.body as HolderBody,
    );
    res.json({ ticket });
  },
);

/** 302 to a 5-minute signed download link. `?redirect=false` returns the link as JSON instead. */
ticketsRouter.get("/:id/pdf", validate({ params: ticketIdParams }), async (req, res) => {
  const url = await tickets.pdfLink(req.auth!.userId, idOf(req.params));
  if (req.query.redirect === "false") res.json({ url, expiresInSeconds: 300 });
  else res.redirect(302, url);
});

/** Mounted at /api/v1/me/tickets */
export const myTicketsRouter = Router();
myTicketsRouter.use(privateNoStore, authenticate);

myTicketsRouter.get("/", validate({ query: myTicketsQuery }), async (req, res) => {
  res.json(await tickets.listMine(req.auth!.userId, req.query as unknown as MyTicketsQuery));
});

/** Mounted at /api/v1/me/staff-events (scanner app: events I can scan for). */
export const myStaffEventsRouter = Router();
myStaffEventsRouter.use(privateNoStore, authenticate);
myStaffEventsRouter.get("/", async (req, res) => {
  res.json({ data: await checkins.myStaffEvents(req.auth!) });
});

/** Mounted at /api/v1/events/:id/check-ins */
export const checkInsRouter = Router({ mergeParams: true });
checkInsRouter.use(privateNoStore, authenticate);

// generous: gates scan in bursts
const scanLimit = limiter({ name: "checkin", windowMs: 60_000, limit: 300, key: byUser });

checkInsRouter.post(
  "/",
  scanLimit,
  validate({ params: eventParams, body: checkInBody }),
  async (req, res) => {
    const result = await checkins.checkIn(
      req.auth!,
      idOf(req.params),
      (req.body as { ticketCode: string }).ticketCode,
    );
    res.json(result);
  },
);

checkInsRouter.get("/stats", validate({ params: eventParams }), async (req, res) => {
  res.json(await checkins.stats(req.auth!, idOf(req.params)));
});

/** Mounted at /api/v1/events/:id/staff */
export const staffRouter = Router({ mergeParams: true });
staffRouter.use(privateNoStore, authenticate);

staffRouter.get("/", validate({ params: eventParams }), async (req, res) => {
  res.json({ data: await checkins.listStaff(req.auth!, idOf(req.params)) });
});

staffRouter.post("/", validate({ params: eventParams, body: addStaffBody }), async (req, res) => {
  const staff = await checkins.addStaff(
    req.auth!,
    idOf(req.params),
    req.body as AddStaffBody,
    req.ip ?? null,
  );
  res.status(201).json({ staff });
});

staffRouter.delete("/:userId", validate({ params: staffParams }), async (req, res) => {
  const { id, userId } = req.params as { id: string; userId: string };
  await checkins.removeStaff(req.auth!, id, userId, req.ip ?? null);
  res.status(204).end();
});
