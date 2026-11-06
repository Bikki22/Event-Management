import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request / per-job context, available anywhere in the async call chain. */
export interface Ctx {
  requestId?: string;
  traceId?: string;
  userId?: string;
  jobId?: string;
  queue?: string;
}

const als = new AsyncLocalStorage<Ctx>();

export const runWithContext = <T>(ctx: Ctx, fn: () => T): T => als.run(ctx, fn);
export const getContext = (): Ctx | undefined => als.getStore();
export const setUserId = (userId: string): void => {
  const store = als.getStore();
  if (store) store.userId = userId;
};
