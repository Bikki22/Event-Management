import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Unguessable opaque token (default 256 bits), base64url. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** sha256 hex digest. Used to store tokens: the DB never sees the raw value. */
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Constant-time string comparison. */
export const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** "john.doe@example.com" → "jo***@example.com" for logs. */
export const maskEmail = (email: string): string => {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 2)}***@${domain}`;
};
