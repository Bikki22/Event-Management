const DEFAULT_API_URL = "http://localhost:4000/api/v1";

/**
 * Base URL of the EMS API (no trailing slash).
 * - Browser: NEXT_PUBLIC_API_URL. In production this is the same-origin path "/api/v1", which
 *   next.config.ts rewrites to the API deployment, so the SameSite=Strict refresh cookie works.
 * - Server (SSR / cached public reads): needs an absolute URL, so API_INTERNAL_URL wins there.
 */
export const API_URL = (
  (typeof window === "undefined" ? process.env.API_INTERNAL_URL : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  DEFAULT_API_URL
).replace(/\/$/, "");
