import { Router } from "express";
import { authenticate, requireVerifiedEmail } from "../../middleware/auth.js";
import { idempotent } from "../../middleware/idempotency.js";
import { byUser, limiter } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import {
  bookingIdParams,
  createBookingBody,
  myBookingsQuery,
  type CreateBookingBody,
  type MyBookingsQuery,
} from "./bookings.schemas.js";
import * as bookings from "./bookings.service.js";

const noStore = Router();
noStore.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

/** Mounted at /api/v1/bookings */
export const bookingsRouter = Router();
bookingsRouter.use(noStore, authenticate);

const bookingLimit = limiter({ name: "booking-create", windowMs: 60_000, limit: 10, key: byUser });

bookingsRouter.post(
  "/",
  bookingLimit,
  requireVerifiedEmail,
  validate({ body: createBookingBody }),
  idempotent,
  async (req, res) => {
    const { booking, created } = await bookings.create(
      req.auth!,
      req.body as CreateBookingBody,
      req.get("idempotency-key")!,
    );
    res
      .status(created ? 201 : 200)
      .location(`/api/v1/bookings/${booking.id}`)
      .json({ booking });
  },
);

bookingsRouter.get("/:id", validate({ params: bookingIdParams }), async (req, res) => {
  res.json({ booking: await bookings.get(req.auth!, (req.params as { id: string }).id) });
});

bookingsRouter.post("/:id/cancel", validate({ params: bookingIdParams }), async (req, res) => {
  res.json({ booking: await bookings.cancel(req.auth!, (req.params as { id: string }).id) });
});

/** Mounted at /api/v1/me/bookings */
export const myBookingsRouter = Router();
myBookingsRouter.use(noStore, authenticate);

myBookingsRouter.get("/", validate({ query: myBookingsQuery }), async (req, res) => {
  res.json(await bookings.listMine(req.auth!, req.query as unknown as MyBookingsQuery));
});
