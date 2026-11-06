import { useAuthStore } from "@/stores/auth-store";
import type { FieldError, Problem, RefreshResponse } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: FieldError[];
  readonly retryAfter?: number;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { errors?: FieldError[]; retryAfter?: number; requestId?: string } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.errors = extra.errors ?? [];
    this.retryAfter = extra.retryAfter;
    this.requestId = extra.requestId;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** Attach the bearer token and retry once after a refresh on 401. Default true. */
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    return await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      // the refresh cookie (ems_rt) lives on the API origin
      credentials: "include",
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.");
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 202) {
    // 202 bodies are empty for our auth endpoints
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  const type = res.headers.get("content-type") ?? "";
  const data: unknown = type.includes("json") ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const p = (data ?? {}) as Partial<Problem>;
    const retry = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, p.code ?? `HTTP_${res.status}`, p.title ?? res.statusText, {
      errors: p.errors,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
      requestId: p.requestId,
    });
  }
  return data as T;
}

// ───────────── refresh (single flight) ─────────────

let inflight: Promise<string | null> | null = null;

async function doRefresh(attempt = 0): Promise<string | null> {
  const res = await send(
    "/auth/refresh",
    { method: "POST", headers: { "X-Requested-With": "fetch" } },
    null,
  );
  try {
    const data = await parse<RefreshResponse>(res);
    useAuthStore.getState().setSession(data);
    return data.accessToken;
  } catch (err) {
    // Another tab may have rotated the cookie a moment ago (server grace window answers
    // REFRESH_INVALID). The browser now holds the new cookie, so one retry usually succeeds.
    if (err instanceof ApiError && err.code === "REFRESH_INVALID" && attempt === 0) {
      await new Promise((r) => setTimeout(r, 400));
      return doRefresh(1);
    }
    throw err;
  }
}

/**
 * Exchanges the HttpOnly refresh cookie for a new access token.
 * Concurrent callers share one request, because each refresh rotates the cookie.
 * Resolves to null when there is no valid session.
 */
export function refreshSession(): Promise<string | null> {
  inflight ??= doRefresh()
    .catch((err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        useAuthStore.getState().clear();
        return null;
      }
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// ───────────── main request helper ─────────────

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const useAuth = opts.auth ?? true;
  const token = useAuth ? useAuthStore.getState().accessToken : null;

  const res = await send(path, opts, token);

  if (res.status === 401 && useAuth && token) {
    const fresh = await refreshSession().catch(() => null);
    if (fresh) return parse<T>(await send(path, opts, fresh));
  }
  return parse<T>(res);
}

/** Human-friendly message for any error thrown by `api()`. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "RATE_LIMITED":
        return err.retryAfter
          ? `Too many attempts. Try again in ${err.retryAfter}s.`
          : "Too many attempts. Please wait a moment and try again.";
      case "INTERNAL_ERROR":
        return "Something went wrong on our side. Please try again.";
      default:
        return err.message;
    }
  }
  return "Something went wrong. Please try again.";
}
