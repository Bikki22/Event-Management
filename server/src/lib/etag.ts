import type { Request, Response } from "express";
import { AppError } from "./errors.js";

/**
 * Optimistic concurrency (backend.md §4.6): editable resources expose `ETag: "v{version}"`
 * and updates must send it back in `If-Match`. A stale version → 412.
 */
export const setVersionEtag = (res: Response, version: number) => {
  res.setHeader("ETag", `"v${version}"`);
};

/** Parses `If-Match: "v3"` (also accepts W/"v3" or v3). Missing → 428. */
export function requireIfMatch(req: Request): number {
  const raw = req.get("if-match");
  if (!raw) {
    throw new AppError(
      428,
      "PRECONDITION_REQUIRED",
      'Send the If-Match header with the ETag you last read (e.g. If-Match: "v3")',
    );
  }
  const m = /^(?:W\/)?"?v(\d{1,9})"?$/.exec(raw.trim());
  if (!m) throw new AppError(400, "INVALID_IF_MATCH", 'If-Match must look like "v3"');
  return Number(m[1]);
}
