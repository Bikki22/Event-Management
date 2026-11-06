import { logger } from "../../lib/logger.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import { getQueue } from "../../lib/queue.js";
import type { EmailPayloads, EmailType } from "./templates/index.js";

const log = logger.child({ module: "notifications" });

/**
 * Transactional outbox (backend.md §8.2):
 * 1. queueEmail() inside the caller's transaction → row in `notifications` (status=queued)
 * 2. after commit, dispatch() enqueues it right away (fast path)
 * 3. relayOutbox() re-enqueues anything still queued after 30 s (safety net)
 * jobId = notification id, so the fast and slow paths never create duplicates.
 */
export async function queueEmail<T extends EmailType>(
  tx: DbOrTx,
  input: { userId: string | null; to: string; type: T; payload: EmailPayloads[T] },
): Promise<string> {
  const row = await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      channel: "email",
      recipient: input.to,
      payload: input.payload,
    },
    select: { id: true },
  });
  return row.id;
}

/** Fast path, called after commit. Never throws: the relay will pick up anything missed. */
export async function dispatch(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  try {
    await getQueue("email").addBulk(
      notificationIds.map((id) => ({
        name: "send",
        data: { notificationId: id },
        opts: { jobId: id, attempts: 8 },
      })),
    );
  } catch (err) {
    log.warn({ err, notificationIds }, "enqueue failed; outbox relay will retry");
  }
}

/** Slow path (repeatable job every 10 s). Returns how many rows were re-enqueued. */
export async function relayOutbox(batchSize = 100): Promise<number> {
  const ids = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM notifications
      WHERE status = 'queued' AND created_at < now() - interval '30 seconds'
      ORDER BY created_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => r.id);
  });
  if (ids.length > 0) {
    await dispatch(ids);
    log.info({ count: ids.length }, "outbox relay re-enqueued notifications");
  }
  return ids.length;
}
