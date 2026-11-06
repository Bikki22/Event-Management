import { existsSync } from "node:fs";
import { z } from "zod";

// Local dev convenience: load .env if present. In Docker/prod, env vars are injected.
// Tests set NODE_ENV=test and load .env.test instead (see vitest.config.ts).
if (process.env.NODE_ENV !== "test" && existsSync(".env")) process.loadEnvFile(".env");

/** PEM keys are stored on one line in .env with literal "\n" sequences. */
const pem = z
  .string()
  .min(1)
  .transform((s) => s.replace(/\\n/g, "\n"));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PROCESS_TYPE: z.enum(["api", "worker", "scheduler"]).default("api"),
    APP_VERSION: z.string().default("dev"),
    APP_NAME: z.string().default("EMS"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    TRUST_PROXY: z.string().default("loopback"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    FRONTEND_URL: z.url().default("http://localhost:5173"),

    // ---- Database / Redis ----
    DATABASE_URL: z.url(),
    DIRECT_URL: z.url(),
    DATABASE_REPLICA_URL: z.url().optional(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    REDIS_URL: z.url(),

    // ---- Auth ----
    JWT_PRIVATE_KEY: pem,
    JWT_PUBLIC_KEY: pem,
    JWT_KEY_ID: z.string().min(1).default("dev-1"),
    JWT_ISSUER: z.string().default("ems-api"),
    JWT_AUDIENCE: z.string().default("ems-web"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    SESSION_MAX_DAYS: z.coerce.number().int().positive().default(90),
    EMAIL_VERIFY_TTL_HOURS: z.coerce.number().int().positive().default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),

    // ---- Encryption at rest (organizer payout details) ----
    // 32-byte key as hex. Generate with: npm run keys:generate -- --write
    DATA_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, { error: "must be 64 hex chars (32 bytes)" }),
    DATA_ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,32}$/)
      .default("k1"),
    // retired keys still needed to decrypt old rows: "id:hex,id:hex"
    DATA_ENCRYPTION_OLD_KEYS: z.string().default(""),

    // ---- Email ----
    EMAIL_DRIVER: z.enum(["resend", "smtp", "console"]).default("smtp"),
    EMAIL_FROM: z.string().min(3).default("EMS <no-reply@ems.local>"),
    RESEND_API_KEY: z.string().optional(),
    SMTP_URL: z.string().default("smtp://localhost:1025"),

    // ---- Business rules ----
    BOOKING_HOLD_MINUTES: z.coerce.number().int().positive().default(10),
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_DRIVER === "resend" && !v.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "required when EMAIL_DRIVER=resend",
      });
    }
    if (v.SESSION_MAX_DAYS < v.REFRESH_TOKEN_TTL_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_MAX_DAYS"],
        message: "must be >= REFRESH_TOKEN_TTL_DAYS",
      });
    }
  });

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Logger depends on env, so print directly and exit (fatal: invalid config).
    console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
