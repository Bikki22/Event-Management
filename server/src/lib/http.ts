import { logger } from "./logger.js";

/** The remote service failed or timed out (as opposed to answering with a business "no"). */
export class GatewayError extends Error {
  constructor(
    public readonly service: string,
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(`${service}: ${message}`);
    this.name = "GatewayError";
  }
}

/**
 * Tiny circuit breaker per service: after 5 consecutive failures, calls fail fast for 30 s
 * instead of piling up 10 s timeouts while a gateway is down.
 */
const breakers = new Map<string, { failures: number; openUntil: number }>();
const FAILURE_THRESHOLD = 5;
const OPEN_MS = 30_000;

function guard(service: string) {
  const b = breakers.get(service);
  if (b && b.openUntil > Date.now()) {
    throw new GatewayError(service, "circuit open (recent failures), try again shortly");
  }
}
function record(service: string, ok: boolean) {
  const b = breakers.get(service) ?? { failures: 0, openUntil: 0 };
  if (ok) {
    b.failures = 0;
  } else if (++b.failures >= FAILURE_THRESHOLD) {
    b.openUntil = Date.now() + OPEN_MS;
    logger.warn({ service }, "circuit breaker opened");
  }
  breakers.set(service, b);
}
export const resetBreakers = () => breakers.clear();

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  timeoutMs?: number;
  /** Retries for safe/idempotent calls (lookups). Never retry non-idempotent ones. */
  retries?: number;
  /** HTTP statuses that are a valid answer (returned, not thrown), e.g. 400 for "not found". */
  acceptStatus?: number[];
}

/** fetch + JSON with a hard timeout, optional retries and the circuit breaker. */
export async function requestJson<T = unknown>(
  service: string,
  url: string,
  opts: RequestOptions = {},
): Promise<{ status: number; data: T }> {
  const attempts = (opts.retries ?? 0) + 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    guard(service);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: { accept: "application/json", ...opts.headers },
        body: opts.body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      const text = await res.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // non-JSON body (gateway HTML error page): keep the text
      }
      if (res.ok || opts.acceptStatus?.includes(res.status)) {
        record(service, true);
        return { status: res.status, data: data as T };
      }
      // 4xx is the gateway rejecting our request: don't retry, don't trip the breaker
      if (res.status < 500) {
        record(service, true);
        throw new GatewayError(service, `HTTP ${res.status}`, res.status, data);
      }
      record(service, false);
      lastErr = new GatewayError(service, `HTTP ${res.status}`, res.status, data);
    } catch (err) {
      if (err instanceof GatewayError && err.status !== undefined && err.status < 500) throw err;
      if (!(err instanceof GatewayError)) record(service, false);
      lastErr =
        err instanceof GatewayError
          ? err
          : new GatewayError(service, err instanceof Error ? err.message : "request failed");
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * 2 ** i));
  }
  throw lastErr;
}
