import type { AuthContext } from "../middleware/auth.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` / `optionalAuth`. */
      auth?: AuthContext;
    }
  }
}

export {};
