"use client";

import { useSyncExternalStore } from "react";

// "now" for render decisions (event ended? refund window open?), read only on the client: server
// renders are cached/prerendered and must not read the clock. The snapshot has to be stable for
// useSyncExternalStore, so it's taken once per page load; that's precise enough for these checks.
const noop = () => () => {};
let loadedAt: number | null = null;

/** Epoch ms on the client, `null` during server rendering. */
export function useNow(): number | null {
  return useSyncExternalStore(noop, () => (loadedAt ??= Date.now()), () => null);
}
