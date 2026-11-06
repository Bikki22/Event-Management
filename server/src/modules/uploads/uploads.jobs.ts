import { UnrecoverableError, type Job } from "bullmq";
import sharp, { type Metadata } from "sharp";
import { env } from "../../config/env.js";
import type { UploadPurpose } from "../../generated/prisma/enums.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { deleteObjects, getObjectBuffer, publicUrl, putObject } from "../../lib/storage.js";
import type { ImageVariants } from "./uploads.dto.js";
import type { MediaJobData } from "./uploads.service.js";

const log = logger.child({ module: "media" });

interface Spec {
  min: { width: number; height: number };
  variants: Record<keyof ImageVariants, { width: number; height: number }>;
}

/** Output sizes per purpose. All variants are cropped to the target aspect ratio, as WebP. */
const SPECS: Record<UploadPurpose, Spec> = {
  event_cover: {
    min: { width: 640, height: 360 },
    variants: {
      lg: { width: 1600, height: 900 },
      md: { width: 800, height: 450 },
      sm: { width: 400, height: 225 },
    },
  },
  organizer_logo: {
    min: { width: 128, height: 128 },
    variants: {
      lg: { width: 512, height: 512 },
      md: { width: 256, height: 256 },
      sm: { width: 96, height: 96 },
    },
  },
};

const FORMAT_FOR: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

/** A problem with the file itself: retrying won't help. */
class InvalidImage extends Error {}

async function inspect(buffer: Buffer, contentType: string, spec: Spec) {
  let meta: Metadata;
  try {
    // limitInputPixels guards against decompression bombs
    meta = await sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  } catch {
    throw new InvalidImage("The file is not a valid image");
  }
  // magic bytes decide the real type, not the declared Content-Type
  if (meta.format !== FORMAT_FOR[contentType]) {
    throw new InvalidImage(`The file content is ${meta.format ?? "unknown"}, not ${contentType}`);
  }
  // EXIF orientation 5-8 means the stored pixels are rotated 90°
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  if (width < spec.min.width || height < spec.min.height) {
    throw new InvalidImage(
      `Image is ${width}×${height}px; it must be at least ${spec.min.width}×${spec.min.height}px`,
    );
  }
  return { width, height };
}

/**
 * Validates the raw upload, strips metadata (EXIF/GPS), writes resized WebP variants to the
 * public media/ prefix and deletes the raw file. Idempotent: re-running a finished job is a no-op.
 */
export async function processMedia(job: Job<MediaJobData>): Promise<void> {
  const { uploadId } = job.data;
  const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!upload || upload.status !== "processing") return;

  const spec = SPECS[upload.purpose];
  const buffer = await getObjectBuffer(upload.objectKey, env.UPLOAD_MAX_BYTES);

  try {
    const { width, height } = await inspect(buffer, upload.contentType, spec);

    const variants = {} as ImageVariants;
    for (const [name, size] of Object.entries(spec.variants) as [
      keyof ImageVariants,
      { width: number; height: number },
    ][]) {
      const out = await sharp(buffer, { limitInputPixels: 40_000_000 })
        .rotate() // apply EXIF orientation; metadata is not copied to the output
        .resize(size.width, size.height, { fit: "cover", position: "attention" })
        .webp({ quality: 82 })
        .toBuffer();
      const key = `media/${upload.purpose}/${upload.id}/${name}.webp`;
      await putObject(key, out, "image/webp");
      variants[name] = publicUrl(key);
    }

    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "ready", variants: { ...variants }, width, height, error: null },
    });
    await deleteObjects([upload.objectKey]);
    log.info({ uploadId, purpose: upload.purpose, width, height }, "media.processed");
  } catch (err) {
    if (!(err instanceof InvalidImage)) throw err; // storage/DB hiccup: let BullMQ retry
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "failed", error: err.message },
    });
    await deleteObjects([upload.objectKey]);
    log.warn({ uploadId, reason: err.message }, "media.rejected");
    throw new UnrecoverableError(err.message);
  }
}
