import { Queue, type JobsOptions } from "bullmq";
import { bullConnection } from "./redis.js";

export type QueueName =
  | "email"
  | "tickets"
  | "booking-expiry"
  | "payments"
  | "refunds"
  | "fanout"
  | "media"
  | "exports"
  | "maintenance";

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 }, // keep a day for debugging
  removeOnFail: { age: 14 * 24 * 3600 }, // failed set kept 14 days = our DLQ
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection, defaultJobOptions });
    queues.set(name, q);
  }
  return q;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
