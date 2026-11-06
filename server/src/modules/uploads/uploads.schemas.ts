import { z } from "zod";
import { env } from "../../config/env.js";

export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const presignBody = z
  .object({
    purpose: z.enum(["event_cover", "organizer_logo"]),
    contentType: z.enum(ALLOWED_CONTENT_TYPES, { error: "Only JPEG, PNG or WebP images" }),
    size: z
      .number()
      .int()
      .min(1)
      .max(env.UPLOAD_MAX_BYTES, {
        error: `Image must be at most ${Math.floor(env.UPLOAD_MAX_BYTES / 1024 / 1024)} MB`,
      }),
  })
  .strict();

export const uploadIdParams = z.object({ id: z.uuid() });

export type PresignBody = z.infer<typeof presignBody>;
