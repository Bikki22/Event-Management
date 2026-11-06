import client from "prom-client";
import { env } from "../config/env.js";

/** Prometheus metrics (backend.md §11). One registry per process (api / worker). */
export const registry = new client.Registry();
registry.setDefaultLabels({ service: "ems", process: env.PROCESS_TYPE });
client.collectDefaultMetrics({ register: registry }); // event loop lag, heap, GC, handles

export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency by route",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const counter = <L extends string>(name: string, help: string, labelNames: readonly L[] = []) =>
  new client.Counter({ name, help, labelNames, registers: [registry] });

// business metrics
export const bookingsCreated = counter("bookings_created_total", "Bookings created", [
  "free",
] as const);
export const bookingsConfirmed = counter("bookings_confirmed_total", "Bookings confirmed");
export const bookingsExpired = counter("bookings_expired_total", "Pending bookings expired");
export const ticketsSoldOut = counter(
  "tickets_sold_out_total",
  "Booking attempts rejected as sold out",
);
export const paymentsVerified = counter("payments_verified_total", "Payment verifications", [
  "provider",
  "result",
] as const);
export const refundsTotal = counter("refunds_total", "Refund state changes", ["status"] as const);
export const checkinsTotal = counter("checkins_total", "Check-in scans", ["result"] as const);
