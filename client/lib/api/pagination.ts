/** Cursor-paginated list envelope used by every list endpoint (server/src/lib/pagination.ts). */
export interface Page<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

/**
 * Options to spread into `useInfiniteQuery`:
 *
 *   useInfiniteQuery({
 *     queryKey: keys.events.list(filters),
 *     queryFn: ({ pageParam }) => eventsApi.list({ ...filters, cursor: pageParam }),
 *     ...cursorPagination<EventCard>(),
 *   })
 */
export function cursorPagination<T>() {
  return {
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: Page<T>) => last.page.nextCursor ?? undefined,
  };
}

/** Flattens infinite-query pages into one array. */
export function flattenPages<T>(pages: Page<T>[] | undefined): T[] {
  return pages?.flatMap((p) => p.data) ?? [];
}
