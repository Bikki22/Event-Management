import { Router, type Request } from "express";
import { AppError } from "../../lib/errors.js";
import { authenticate, requireCsrfHeader } from "../../middleware/auth.js";
import { authLimits } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import type { ClientMeta } from "./auth.repository.js";
import {
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  sessionIdParams,
  verifyEmailBody,
  type ChangePasswordBody,
  type LoginBody,
  type RegisterBody,
  type ResetPasswordBody,
} from "./auth.schemas.js";
import * as auth from "./auth.service.js";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./cookies.js";

const meta = (req: Request): ClientMeta => ({
  ip: req.ip ?? null,
  userAgent: req.get("user-agent")?.slice(0, 512) ?? null,
});

export const authRouter = Router();

// Nothing under /auth may be cached by browsers or proxies.
authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

authRouter.post(
  "/register",
  authLimits.register,
  validate({ body: registerBody }),
  async (req, res) => {
    const r = await auth.register(req.body as RegisterBody, meta(req));
    setRefreshCookie(res, r.refreshToken, r.refreshExpiresAt);
    res
      .status(201)
      .location("/api/v1/me")
      .json({ user: r.user, accessToken: r.accessToken, expiresIn: r.expiresIn });
  },
);

authRouter.post(
  "/login",
  authLimits.loginIp,
  authLimits.loginEmailMin,
  authLimits.loginEmailHour,
  validate({ body: loginBody }),
  async (req, res) => {
    const r = await auth.login(req.body as LoginBody, meta(req));
    setRefreshCookie(res, r.refreshToken, r.refreshExpiresAt);
    res.json({ user: r.user, accessToken: r.accessToken, expiresIn: r.expiresIn });
  },
);

authRouter.post("/refresh", authLimits.refresh, requireCsrfHeader, async (req, res) => {
  const token = readRefreshCookie(req);
  if (!token) {
    clearRefreshCookie(res);
    throw new AppError(401, "REFRESH_INVALID", "Session expired, please sign in again");
  }
  try {
    const r = await auth.refresh(token, meta(req));
    setRefreshCookie(res, r.refreshToken, r.refreshExpiresAt);
    res.json({ accessToken: r.accessToken, expiresIn: r.expiresIn });
  } catch (err) {
    // a dead refresh token is useless to the client: drop the cookie
    if (err instanceof AppError && err.status === 401) clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post("/logout", authenticate, async (req, res) => {
  await auth.logout(req.auth!.userId, req.auth!.sessionId);
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.post(
  "/verify-email",
  authLimits.tokenLinks,
  validate({ body: verifyEmailBody }),
  async (req, res) => {
    const user = await auth.verifyEmail((req.body as { token: string }).token);
    res.json({ user });
  },
);

authRouter.post(
  "/resend-verification",
  authenticate,
  authLimits.resendVerification,
  async (req, res) => {
    await auth.resendVerification(req.auth!.userId);
    res.status(202).end();
  },
);

authRouter.post(
  "/forgot-password",
  authLimits.forgotIp,
  authLimits.forgotEmail,
  validate({ body: forgotPasswordBody }),
  (req, res) => {
    // Respond first: identical, equally fast response whether or not the account exists.
    res.status(202).end();
    void auth.forgotPassword((req.body as { email: string }).email, meta(req));
  },
);

authRouter.post(
  "/reset-password",
  authLimits.tokenLinks,
  validate({ body: resetPasswordBody }),
  async (req, res) => {
    await auth.resetPassword(req.body as ResetPasswordBody, meta(req));
    clearRefreshCookie(res);
    res.status(204).end();
  },
);

authRouter.post(
  "/change-password",
  authenticate,
  validate({ body: changePasswordBody }),
  async (req, res) => {
    await auth.changePassword(
      req.auth!.userId,
      req.auth!.sessionId,
      req.body as ChangePasswordBody,
      meta(req),
    );
    res.status(204).end();
  },
);

authRouter.get("/sessions", authenticate, async (req, res) => {
  res.json({ data: await auth.listSessions(req.auth!.userId, req.auth!.sessionId) });
});

authRouter.delete(
  "/sessions/:id",
  authenticate,
  validate({ params: sessionIdParams }),
  async (req, res) => {
    const { id } = req.params as { id: string };
    await auth.revokeSessionById(req.auth!.userId, id);
    if (id === req.auth!.sessionId) clearRefreshCookie(res);
    res.status(204).end();
  },
);
