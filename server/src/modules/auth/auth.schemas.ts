import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "./password.js";

const email = z.email({ error: "Enter a valid email address" }).trim().toLowerCase().max(254);

const password = z
  .string()
  .min(PASSWORD_MIN, { error: `Password must be at least ${PASSWORD_MIN} characters` })
  .max(PASSWORD_MAX, { error: `Password must be at most ${PASSWORD_MAX} characters` });

// opaque base64url tokens from emails
const linkToken = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,128}$/, { error: "Invalid token" });

// .strict(): unknown fields are rejected (no mass assignment, e.g. `role`)
export const registerBody = z
  .object({
    email,
    password,
    fullName: z.string().trim().min(1).max(120),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, { error: "Invalid phone number" })
      .optional(),
  })
  .strict();

export const loginBody = z
  .object({
    email,
    // don't apply min-length on login: old accounts may predate the rule
    password: z.string().min(1).max(PASSWORD_MAX),
  })
  .strict();

export const verifyEmailBody = z.object({ token: linkToken }).strict();
export const forgotPasswordBody = z.object({ email }).strict();
export const resetPasswordBody = z.object({ token: linkToken, newPassword: password }).strict();
export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX),
    newPassword: password,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    error: "New password must be different from the current one",
  });

export const sessionIdParams = z.object({ id: z.uuid() });

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;
