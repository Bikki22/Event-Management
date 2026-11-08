import { z } from "zod";

// Mirrors server/src/modules/auth/auth.schemas.ts so users see errors before a round trip.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const email = z
  .string()
  .trim()
  .min(1, { error: "Email is required" })
  .pipe(z.email({ error: "Enter a valid email address" }).max(254));

const newPassword = z
  .string()
  .min(PASSWORD_MIN, { error: `Use at least ${PASSWORD_MIN} characters` })
  .max(PASSWORD_MAX, { error: `Use at most ${PASSWORD_MAX} characters` });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, { error: "Password is required" }).max(PASSWORD_MAX),
});

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(1, { error: "Name is required" }).max(120),
    email,
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\+?[0-9 ()-]{7,20}$/.test(v), { error: "Enter a valid phone number" }),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    error: "Passwords don't match",
  });

export const forgotSchema = z.object({ email });

export const resetSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    error: "Passwords don't match",
  });

export const profileSchema = z.object({
  fullName: z.string().trim().min(1, { error: "Name is required" }).max(120),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\+?[0-9 ()-]{7,20}$/.test(v), { error: "Enter a valid phone number" }),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { error: "Enter your current password" }).max(PASSWORD_MAX),
    newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], error: "Passwords don't match" })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    error: "Choose a password different from your current one",
  });

export type ProfileValues = z.infer<typeof profileSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotValues = z.infer<typeof forgotSchema>;
export type ResetValues = z.infer<typeof resetSchema>;

/** 0–4 score; length matters most (NIST), variety adds a little. */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= PASSWORD_MIN) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return pw.length < PASSWORD_MIN ? Math.min(score, 1) : Math.max(score, 1);
}
