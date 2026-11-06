import type { Upload } from "../../generated/prisma/client.js";

export interface ImageVariants {
  sm: string;
  md: string;
  lg: string;
}

export interface UploadDto {
  id: string;
  purpose: Upload["purpose"];
  status: Upload["status"];
  variants: ImageVariants | null;
  width: number | null;
  height: number | null;
  error: string | null;
  createdAt: string;
}

export const variantsOf = (u: Pick<Upload, "variants" | "status"> | null | undefined) =>
  u && u.status === "ready" ? (u.variants as unknown as ImageVariants) : null;

export const toUploadDto = (u: Upload): UploadDto => ({
  id: u.id,
  purpose: u.purpose,
  status: u.status,
  variants: variantsOf(u),
  width: u.width,
  height: u.height,
  error: u.error,
  createdAt: u.createdAt.toISOString(),
});
