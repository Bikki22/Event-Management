import { BadRequest } from "./errors.js";

/** Response envelope for cursor-paginated lists (backend.md §4.4). */
export interface Page<T> {
  data: T[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

/** Opaque cursor: base64url JSON. Clients must treat it as a black box. */
export const encodeCursor = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export function decodeCursor<T>(cursor: string, isValid: (v: unknown) => v is T): T {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (isValid(value)) return value;
  } catch {
    // fall through
  }
  throw BadRequest("INVALID_CURSOR", "The pagination cursor is invalid");
}

/** Given limit + 1 rows, builds the page; `cursorOf` derives the cursor value from the last item. */
export function toPage<R, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
  cursorOf: (row: R) => unknown,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    data: items.map(map),
    page: { nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null, hasMore, limit },
  };
}
