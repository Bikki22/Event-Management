import { api, ApiError } from "./client";
import type { ImageVariants } from "./events";

// Browser → storage uploads (server/src/modules/uploads, upload.md). The API only signs the
// upload; bytes go straight to storage, then a worker validates and resizes the image.

export type UploadPurpose = "event_cover" | "organizer_logo";

export interface Upload {
  id: string;
  purpose: UploadPurpose;
  status: "pending" | "processing" | "ready" | "failed";
  variants: ImageVariants | null;
  width: number | null;
  height: number | null;
  error: string | null;
  createdAt: string;
}

interface Presigned {
  uploadId: string;
  method: "POST";
  url: string;
  fields: Record<string, string>;
  maxBytes: number;
  expiresAt: string;
}

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_BYTES = 5 * 1024 * 1024; // server UPLOAD_MAX_BYTES
export const MIN_SIZE: Record<UploadPurpose, { width: number; height: number }> = {
  event_cover: { width: 640, height: 360 },
  organizer_logo: { width: 128, height: 128 },
};

export const uploadsApi = {
  presign: (purpose: UploadPurpose, file: File) =>
    api<Presigned>("/uploads/presign", { method: "POST", body: { purpose, contentType: file.type, size: file.size } }),
  complete: (id: string) => api<{ upload: Upload }>(`/uploads/${encodeURIComponent(id)}/complete`, { method: "POST" }),
  get: (id: string) => api<{ upload: Upload }>(`/uploads/${encodeURIComponent(id)}`),
};

/** Checks type, size and minimum dimensions before anything is sent. Returns an error message or null. */
export async function checkImage(file: File, purpose: UploadPurpose): Promise<string | null> {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) return "Use a JPEG, PNG or WebP image.";
  if (file.size > MAX_BYTES) return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB.`;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    const min = MIN_SIZE[purpose];
    if (width < min.width || height < min.height) {
      return `That image is ${width}×${height}px; it needs to be at least ${min.width}×${min.height}px.`;
    }
  } catch {
    return "We couldn't read that image. Try another file.";
  }
  return null;
}

/** POSTs the signed form to storage with progress (fetch can't report upload progress). */
function sendToStorage(p: Presigned, file: File, onProgress: (pct: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(p.fields)) form.append(k, v);
    form.append("file", file); // must come after the policy fields

    const xhr = new XMLHttpRequest();
    xhr.open("POST", p.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, "STORAGE_REJECTED", "The storage server refused the file. Check its type and size."));
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Full flow: presign → upload → complete → wait for the worker. Resolves with the ready upload
 * (use its id as logoUploadId / coverUploadId); rejects with a readable error.
 */
export async function uploadImage(
  file: File,
  purpose: UploadPurpose,
  hooks: { onProgress?: (pct: number) => void; onStage?: (stage: "uploading" | "processing") => void; signal?: AbortSignal } = {},
): Promise<Upload> {
  hooks.onStage?.("uploading");
  const presigned = await uploadsApi.presign(purpose, file);
  await sendToStorage(presigned, file, hooks.onProgress ?? (() => {}), hooks.signal);

  hooks.onStage?.("processing");
  let { upload } = await uploadsApi.complete(presigned.uploadId);
  // the worker usually finishes in 1–3 s; give it up to ~45 s before giving up
  for (let i = 0; i < 30 && (upload.status === "processing" || upload.status === "pending"); i++) {
    if (hooks.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    await sleep(i < 5 ? 800 : 1500);
    ({ upload } = await uploadsApi.get(upload.id));
  }
  if (upload.status === "failed") throw new ApiError(422, "UPLOAD_FAILED", upload.error ?? "The image couldn't be processed.");
  if (upload.status !== "ready") {
    throw new ApiError(504, "UPLOAD_TIMEOUT", "Processing is taking too long. Is the worker running (npm run dev:worker)?");
  }
  return upload;
}
