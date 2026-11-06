import { Prisma } from "../generated/prisma/client.js";

/** Field-level error, used in the `errors[]` array of a problem+json response. */
export interface FieldError {
  path: string;
  message: string;
}

/**
 * Base class for every error we intentionally return to clients.
 * Rendered as RFC 9457 problem+json by the error handler.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly errors?: FieldError[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export const BadRequest = (code: string, msg: string, errors?: FieldError[]) =>
  new AppError(400, code, msg, undefined, errors);
export const Unauthorized = (code = "UNAUTHORIZED", msg = "Authentication required") =>
  new AppError(401, code, msg);
export const Forbidden = (code = "FORBIDDEN", msg = "You do not have access to this resource") =>
  new AppError(403, code, msg);
export const NotFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const Conflict = (code: string, msg: string, details?: unknown) =>
  new AppError(409, code, msg, details);
export const PreconditionFailed = () =>
  new AppError(412, "PRECONDITION_FAILED", "Resource was modified by someone else");
export const Unprocessable = (code: string, msg: string, details?: unknown) =>
  new AppError(422, code, msg, details);
export const ServiceUnavailable = (code: string, msg: string) => new AppError(503, code, msg);

/** True when `err` is a Prisma unique-constraint violation (optionally on a given field). */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  if (!field) return true;
  return JSON.stringify(err.meta ?? {}).includes(field);
}

/** Prisma / Postgres errors → API errors. DB constraints are our safety net. */
export function mapDbError(err: unknown): AppError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return Conflict("DUPLICATE", "Resource already exists");
      case "P2003":
        return new AppError(422, "INVALID_REFERENCE", "Referenced resource does not exist");
      case "P2025":
        return NotFound("Resource");
      case "P2034":
        return new AppError(503, "RETRY", "Temporary conflict, please retry");
      case "P2024":
        return new AppError(503, "DB_BUSY", "Service is busy, please retry");
      case "P2028":
        return new AppError(504, "TX_TIMEOUT", "The request took too long");
      case "P2010":
        return mapPgCode(String((err.meta as { code?: string } | undefined)?.code ?? ""));
    }
  }
  const cause = (err as { cause?: { originalCode?: string; code?: string } } | null)?.cause;
  return mapPgCode(cause?.originalCode ?? cause?.code ?? "");
}

function mapPgCode(code: string): AppError | null {
  switch (code) {
    case "23505":
      return Conflict("DUPLICATE", "Resource already exists");
    case "23514":
      return Conflict("CONSTRAINT_VIOLATION", "Request violates a business rule");
    case "23503":
      return new AppError(422, "INVALID_REFERENCE", "Referenced resource does not exist");
    case "40001":
    case "40P01":
      return new AppError(503, "RETRY", "Temporary conflict, please retry");
    case "57014":
      return new AppError(504, "QUERY_TIMEOUT", "The request took too long");
    default:
      return null;
  }
}
