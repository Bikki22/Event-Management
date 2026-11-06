import { randomUUID } from "node:crypto";
import type { UploadPurpose } from "../../generated/prisma/enums.js";
import { env } from "../../config/env.js";
import { AppError, Conflict, NotFound, Unprocessable } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import { getQueue } from "../../lib/queue.js";
import { deleteObjects, headObject, presignUpload } from "../../lib/storage.js";
import { toUploadDto, type UploadDto } from "./uploads.dto.js";
import type { PresignBody } from "./uploads.schemas.js";

const log = logger.child({ module: "uploads" });

/** How long the browser has to send the file after asking for a presigned form. */
export const PRESIGN_TTL_SECONDS = 600;

export interface MediaJobData {
  uploadId: string;
}

/**
 * Step 1: record the upload and hand back a presigned POST form.
 * The file goes browser → storage directly; the API never handles the bytes.
 */
export async function presign(userId: string, input: PresignBody) {
  const upload = await prisma.upload.create({
    data: {
      userId,
      purpose: input.purpose,
      contentType: input.contentType,
      sizeBytes: input.size,
      objectKey: `tmp/${randomUUID()}`, // private prefix; random, so it can't be guessed
    },
  });
  const objectKey = upload.objectKey;

  const form = await presignUpload({
    key: objectKey,
    contentType: input.contentType,
    // the declared size is a hint; the policy enforces the hard limit
    maxBytes: env.UPLOAD_MAX_BYTES,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
  });
  log.info({ userId, uploadId: upload.id, purpose: input.purpose }, "uploads.presigned");
  return {
    uploadId: upload.id,
    method: "POST" as const,
    url: form.url,
    fields: form.fields,
    maxBytes: env.UPLOAD_MAX_BYTES,
    expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString(),
  };
}

async function findOwned(userId: string, id: string) {
  const upload = await prisma.upload.findUnique({ where: { id } });
  // someone else's upload looks exactly like a missing one
  if (!upload || upload.userId !== userId) throw NotFound("Upload");
  return upload;
}

/**
 * Step 2: the client says "done". We check the object really exists, then queue processing.
 * Idempotent: calling it again returns the current state.
 */
export async function complete(userId: string, id: string): Promise<UploadDto> {
  const upload = await findOwned(userId, id);
  if (upload.status !== "pending") return toUploadDto(upload);

  const head = await headObject(upload.objectKey);
  if (!head) {
    throw Conflict("FILE_NOT_UPLOADED", "The file hasn't been uploaded to storage yet");
  }

  const { count } = await prisma.upload.updateMany({
    where: { id, status: "pending" },
    data: { status: "processing", sizeBytes: head.size },
  });
  if (count === 1) {
    await getQueue("media").add("process", { uploadId: id } satisfies MediaJobData, {
      jobId: id,
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
    });
  }
  return toUploadDto(await findOwned(userId, id));
}

export async function get(userId: string, id: string): Promise<UploadDto> {
  return toUploadDto(await findOwned(userId, id));
}

/**
 * Used by other modules (event cover, organizer logo): the upload must belong to the user,
 * have the right purpose and be fully processed.
 */
export async function requireReadyUpload(
  userId: string,
  uploadId: string,
  purpose: UploadPurpose,
  db: DbOrTx = prisma,
) {
  const upload = await db.upload.findUnique({ where: { id: uploadId } });
  if (!upload || upload.userId !== userId || upload.purpose !== purpose) {
    throw Unprocessable("INVALID_UPLOAD", `Upload not found (expected a ${purpose} upload)`);
  }
  if (upload.status !== "ready") {
    throw new AppError(
      422,
      "UPLOAD_NOT_READY",
      upload.status === "failed"
        ? `This image was rejected: ${upload.error ?? "invalid image"}`
        : "This image is still being processed, try again in a moment",
    );
  }
  return upload;
}

/** Maintenance: forget uploads that were never completed or failed, and their raw files. */
export async function purgeStaleUploads(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const stale = await prisma.upload.findMany({
    where: { status: { in: ["pending", "failed"] }, createdAt: { lt: cutoff } },
    select: { id: true, objectKey: true },
    take: 500,
  });
  if (stale.length === 0) return 0;
  await deleteObjects(stale.map((u) => u.objectKey));
  await prisma.upload.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  log.info({ count: stale.length }, "uploads.purged");
  return stale.length;
}
