import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError, errorMessage } from "@/lib/api/client";

/**
 * Puts server VALIDATION_FAILED field errors on the matching inputs.
 * Returns a message for the form-level alert, or null if every error landed on a field.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  rename: Partial<Record<string, Path<T>>> = {},
): string | null {
  if (err instanceof ApiError && err.errors.length > 0) {
    let unmatched = false;
    for (const e of err.errors) {
      const name = (rename[e.path] ?? e.path) as Path<T>;
      if (fields.includes(name)) setError(name, { type: "server", message: e.message }, { shouldFocus: true });
      else unmatched = true;
    }
    return unmatched ? errorMessage(err) : null;
  }
  return errorMessage(err);
}
