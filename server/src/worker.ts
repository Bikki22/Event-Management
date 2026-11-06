import { Worker, type Job } from "bullmq";
import { logger } from "./lib/logger.js";
import { runWithContext } from "./lib/context.js";
import { disconnectPrisma } from "./lib/prisma.js";
import { closeQueues, getQueue } from "./lib/queue.js";
import { bullConnection, disconnectRedis } from "./lib/redis.js";
import { purgeExpiredAuthData } from "./modules/auth/auth.jobs.js";
import { processEmail, type EmailJobData } from "./modules/notifications/notifications.jobs.js";
import { relayOutbox } from "./modules/notifications/notifications.service.js";
import { completeEndedEvents } from "./modules/events/events.service.js";
import {
  expire as expireBooking,
  sweepExpired as sweepExpiredBookings,
  type BookingExpiryJobData,
} from "./modules/bookings/bookings.service.js";
import { generateTicketPdf, sweepMissingPdfs } from "./modules/tickets/tickets.jobs.js";
import type { TicketPdfJobData } from "./modules/tickets/tickets.service.js";
import { processMedia } from "./modules/uploads/uploads.jobs.js";
import { purgeStaleUploads, type MediaJobData } from "./modules/uploads/uploads.service.js";

/**
 * Worker process: consumes queues and (for now) also registers the repeatable maintenance jobs.
 * BullMQ dedupes job schedulers by id, so running several workers is safe.
 */

const traced =
  <T>(queue: string, fn: (job: Job<T>) => Promise<unknown>) =>
  (job: Job<T>) =>
    runWithContext({ jobId: job.id, queue }, () => fn(job));

function onFailed(worker: Worker, queue: string) {
  worker.on("failed", (job, err) => {
    const log = logger.child({ queue, jobId: job?.id, attempt: job?.attemptsMade });
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      log.error({ err }, "job exhausted retries, moved to failed set");
    } else {
      log.warn({ err }, "job failed, will retry");
    }
  });
  worker.on("error", (err) => logger.error({ err, queue }, "worker error"));
}

// ---- email ----
const emailWorker = new Worker<EmailJobData>("email", traced("email", processEmail), {
  connection: bullConnection,
  concurrency: 20,
  limiter: { max: 10, duration: 1_000 }, // provider quota
});
onFailed(emailWorker, "email");

// ---- media (image validation + resizing; CPU-bound, so low concurrency) ----
const mediaWorker = new Worker<MediaJobData>("media", traced("media", processMedia), {
  connection: bullConnection,
  concurrency: 2,
});
onFailed(mediaWorker, "media");

// ---- booking expiry (delayed job per pending booking) ----
const expiryWorker = new Worker<BookingExpiryJobData>(
  "booking-expiry",
  traced("booking-expiry", (job) => expireBooking(job.data.bookingId)),
  { connection: bullConnection, concurrency: 10 },
);
onFailed(expiryWorker, "booking-expiry");

// ---- tickets (PDF rendering; CPU-bound) ----
const ticketsWorker = new Worker<TicketPdfJobData>(
  "tickets",
  traced("tickets", generateTicketPdf),
  {
    connection: bullConnection,
    concurrency: 5,
  },
);
onFailed(ticketsWorker, "tickets");

// ---- maintenance (repeatable) ----
const maintenanceHandlers: Record<string, () => Promise<unknown>> = {
  "outbox-relay": () => relayOutbox(),
  "purge-auth": () => purgeExpiredAuthData(),
  "purge-uploads": () => purgeStaleUploads(),
  "complete-events": () => completeEndedEvents(),
  "expire-bookings": () => sweepExpiredBookings(),
  "ticket-pdfs": () => sweepMissingPdfs(),
};

const maintenanceWorker = new Worker(
  "maintenance",
  traced("maintenance", async (job) => {
    const handler = maintenanceHandlers[job.name];
    if (!handler) throw new Error(`unknown maintenance job: ${job.name}`);
    await handler();
  }),
  { connection: bullConnection, concurrency: 1 },
);
onFailed(maintenanceWorker, "maintenance");

async function registerSchedules() {
  const q = getQueue("maintenance");
  const opts = { attempts: 3, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } };
  await q.upsertJobScheduler("outbox-relay", { every: 10_000 }, { name: "outbox-relay", opts });
  await q.upsertJobScheduler("purge-auth", { pattern: "0 3 * * *" }, { name: "purge-auth", opts });
  await q.upsertJobScheduler(
    "purge-uploads",
    { pattern: "30 3 * * *" },
    { name: "purge-uploads", opts },
  );
  await q.upsertJobScheduler(
    "complete-events",
    { every: 15 * 60_000 },
    { name: "complete-events", opts },
  );
}

registerSchedules()
  .then(() =>
    logger.info(
      { queues: ["email", "media", "booking-expiry", "tickets", "maintenance"] },
      "worker started",
    ),
  )
  .catch((err: unknown) => {
    logger.fatal({ err }, "failed to register job schedules");
    process.exit(1);
  });

// ---- graceful shutdown ----
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker shutting down");
  setTimeout(() => {
    logger.error("worker shutdown timed out, forcing exit");
    process.exit(1);
  }, 25_000).unref();
  // let in-flight jobs finish; stalled-job detection re-queues anything interrupted
  await Promise.all([
    emailWorker.close(),
    mediaWorker.close(),
    expiryWorker.close(),
    ticketsWorker.close(),
    maintenanceWorker.close(),
  ]);
  await closeQueues();
  await disconnectPrisma();
  await disconnectRedis();
  logger.info("worker stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled promise rejection");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  process.exit(1);
});
