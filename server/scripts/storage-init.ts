/**
 * Creates the uploads bucket and its public-read policy for processed images (media/*).
 *   npm run storage:init
 */
import { env } from "../src/config/env.js";
import { ensureBucket } from "../src/lib/storage.js";

await ensureBucket();
console.log(`Bucket "${env.S3_BUCKET}" ready (media/* is public, tmp/* is private).`);
