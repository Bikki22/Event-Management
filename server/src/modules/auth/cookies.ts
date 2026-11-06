import type { CookieOptions, Request, Response } from "express";
import { isProd } from "../../config/env.js";

export const REFRESH_COOKIE = "ems_rt";

const base: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "strict",
  path: "/api/v1/auth",
};

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, { ...base, expires: expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, base);
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}
