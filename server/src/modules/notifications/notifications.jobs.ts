import { UnrecoverableError, type Job } from "bullmq";
import { Prisma } from "../../generated/prisma/client.js";
import { maskEmail } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { getEmailProvider } from "./email/provider.js";
import { renderEmail, SECRET_PAYLOAD_KEYS } from "./templates/index.js";

const log = logger.child({ module: "notifications" });

export interface EmailJobData {
  notificationId: string;
}

/** Idempotent: safe to run more than once for the same notification. */
export async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const { notificationId } = job.data;
  const n = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!n) {
    log.warn({ notificationId }, "notification not found; skipping");
    return;
  }
  if (n.status !== "queued") return; // already sent / permanently failed

  const provider = getEmailProvider();
  try {
    const email = renderEmail(n.type, n.payload);
    const { id: providerMessageId } = await provider.send(
      { to: n.recipient, ...email, tags: { type: n.type.replace(/\W/g, "_") } },
      { idempotencyKey: n.id },
    );

    await prisma.notification.update({
      where: { id: n.id },
      data: {
        status: "sent",
        sentAt: new Date(),
        providerMessageId,
        attempts: { increment: 1 },
        lastError: null,
        payload: scrubSecrets(n.payload),
      },
    });
    log.info(
      { notificationId: n.id, type: n.type, to: maskEmail(n.recipient), provider: provider.name },
      "email.sent",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent =
      err instanceof UnrecoverableError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await prisma.notification.update({
      where: { id: n.id },
      data: {
        attempts: { increment: 1 },
        lastError: message.slice(0, 1000),
        ...(permanent ? { status: "failed" as const, payload: scrubSecrets(n.payload) } : {}),
      },
    });
    throw err;
  }
}

/** One-time tokens only need to live until the email is out; don't keep them in the DB. */
function scrubSecrets(payload: Prisma.JsonValue): Prisma.InputJsonValue {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return (payload ?? {}) as Prisma.InputJsonValue;
  }
  const copy = { ...(payload as Record<string, Prisma.JsonValue>) };
  for (const key of SECRET_PAYLOAD_KEYS) if (key in copy) copy[key] = null;
  return copy as Prisma.InputJsonValue;
}
