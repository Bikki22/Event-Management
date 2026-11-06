import type { RequestHandler } from "express";
import type { ZodType } from "zod";

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and replaces req.body / req.query / req.params with the parsed (typed, stripped) values.
 * A ZodError is thrown and turned into a 400 problem+json by the error handler.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    if (schemas.params) {
      Object.defineProperty(req, "params", {
        value: schemas.params.parse(req.params),
        writable: true,
      });
    }
    if (schemas.query) {
      // Express 5: req.query is a getter, so redefine it
      Object.defineProperty(req, "query", {
        value: schemas.query.parse(req.query),
        writable: true,
      });
    }
    if (schemas.body) {
      req.body = schemas.body.parse(req.body ?? {});
    }
    next();
  };
