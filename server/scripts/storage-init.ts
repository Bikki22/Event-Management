/**
 * Creates the uploads bucket, its public-read policy for processed images (media/*), and the CORS
 * rule that lets the frontend (CORS_ORIGINS) upload directly from the browser. Re-run after
 * changing CORS_ORIGINS.
 *   npm run storage:init
 */
import { env } from "../src/config/env.js";
import { ensureBucket } from "../src/lib/storage.js";

await ensureBucket();
console.log(
  `Bucket "${env.S3_BUCKET}" ready (media/* is public, tmp/* is private; CORS allows ${env.CORS_ORIGINS.join(", ")}).`,
);
