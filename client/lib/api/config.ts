/** Base URL of the EMS API, e.g. http://localhost:4000/api/v1 (no trailing slash). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
