import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { createPresignedPost, type PresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

/**
 * Object storage over the S3 API (RustFS locally, S3 / R2 in prod).
 * Layout:
 *   tmp/{uploadId}                        private: raw browser uploads, deleted after processing
 *   media/{purpose}/{uploadId}/{v}.webp   public-read: processed variants, served via S3_PUBLIC_URL / CDN
 */
export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED", // S3-compatible servers vary in checksum support
  responseChecksumValidation: "WHEN_REQUIRED",
});

const Bucket = env.S3_BUCKET;
const publicBase = (
  env.S3_PUBLIC_URL ?? `${env.S3_ENDPOINT ?? `https://${Bucket}.s3.amazonaws.com`}/${Bucket}`
).replace(/\/+$/, "");

export const publicUrl = (key: string) => `${publicBase}/${key}`;

/**
 * Presigned POST: unlike a presigned PUT, the policy enforces the exact Content-Type
 * and a byte range server-side, so the browser can't upload something bigger or different.
 */
export function presignUpload(opts: {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresInSeconds: number;
}): Promise<PresignedPost> {
  return createPresignedPost(s3, {
    Bucket,
    Key: opts.key,
    Conditions: [
      ["content-length-range", 1, opts.maxBytes],
      ["eq", "$Content-Type", opts.contentType],
    ],
    Fields: { "Content-Type": opts.contentType },
    Expires: opts.expiresInSeconds,
  });
}

/** Size + content type of an object, or null if it doesn't exist. */
export async function headObject(key: string) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
  } catch (err) {
    if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function getObjectBuffer(key: string, maxBytes: number): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
  if ((r.ContentLength ?? 0) > maxBytes) throw new Error("object larger than allowed");
  return Buffer.from(await r.Body!.transformToByteArray());
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl = "public, max-age=31536000, immutable", // media keys are unique per upload
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

/** Short-lived download link for a private object (e.g. a ticket PDF). */
export function signedDownloadUrl(
  key: string,
  opts: { expiresInSeconds: number; filename: string },
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${opts.filename.replace(/[^\w.-]/g, "_")}"`,
      ResponseCacheControl: "private, no-store",
    }),
    { expiresIn: opts.expiresInSeconds },
  );
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await s3.send(
    new DeleteObjectsCommand({
      Bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}

/** Creates the bucket if needed and makes only `media/*` publicly readable. Idempotent. */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket }));
  }
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadProcessedMedia",
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${Bucket}/media/*`],
          },
        ],
      }),
    }),
  );
}
