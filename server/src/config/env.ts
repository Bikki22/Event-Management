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
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    // Express "trust proxy": "true" (trust all, e.g. behind Vercel's edge), a hop count like "1",
    // or a comma-separated list of names/CIDRs like "loopback,10.0.0.0/8"
    TRUST_PROXY: z
      .string()
      .default("loopback")
      .transform((s): boolean | number | string =>
        s === "true" ? true : s === "false" ? false : /^\d+$/.test(s) ? Number(s) : s,
      ),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    FRONTEND_URL: z.url().default("http://localhost:3000"),

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

    // ---- Object storage (S3 API: RustFS locally, AWS S3 / Cloudflare R2 in prod) ----
    S3_ENDPOINT: z.url().optional(), // omit for AWS S3
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.stringbool().default(true), // needed for RustFS/MinIO
    // public base URL for processed images (CDN in prod), e.g. http://localhost:9000/ems-media
    S3_PUBLIC_URL: z.url().optional(),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),

    // ---- Email ----
    EMAIL_DRIVER: z.enum(["resend", "smtp", "console"]).default("smtp"),
    EMAIL_FROM: z.string().min(3).default("EMS <no-reply@ems.local>"),
    RESEND_API_KEY: z.string().optional(),
    SMTP_URL: z.string().default("smtp://localhost:1025"),

    // ---- Business rules ----
    BOOKING_HOLD_MINUTES: z.coerce.number().int().positive().default(10),
    // buyers can refund themselves until this many hours before the event starts
    REFUND_CUTOFF_HOURS: z.coerce.number().int().min(0).default(48),

    // ---- Payments ----
    // where gateways send the buyer back (frontend page that calls POST /payments/{provider}/verify)
    PAYMENT_RETURN_URL: z.url().optional(),
    KHALTI_SECRET_KEY: z.string().min(1).optional(), // enables Khalti
    KHALTI_BASE_URL: z.url().default("https://dev.khalti.com/api/v2"), // prod: https://khalti.com/api/v2
    ESEWA_PRODUCT_CODE: z.string().min(1).optional(), // enables eSewa (UAT: EPAYTEST)
    ESEWA_SECRET_KEY: z.string().min(1).optional(),
    ESEWA_FORM_URL: z.url().default("https://rc-epay.esewa.com.np/api/epay/main/v2/form"),
    ESEWA_STATUS_URL: z.url().default("https://rc.esewa.com.np/api/epay/transaction/status/"),
    STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(), // enables Stripe
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
    STRIPE_API_BASE: z.url().default("https://api.stripe.com"),
    // fake gateway for local development and tests; never allowed in production
    PAYMENT_MOCK_ENABLED: z.stringbool().default(false),

    // ---- Metrics ----
    // bearer token for GET /metrics; without it only loopback/private-network callers are allowed
    METRICS_TOKEN: z.string().min(16).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === "production" && v.PAYMENT_MOCK_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_MOCK_ENABLED"],
        message: "the mock payment provider can't be enabled in production",
      });
    }
    if (!!v.ESEWA_PRODUCT_CODE !== !!v.ESEWA_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ESEWA_SECRET_KEY"],
        message: "set ESEWA_PRODUCT_CODE and ESEWA_SECRET_KEY together",
      });
    }
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
  // "KEY=" (blank) in a .env file means "not set"
  const vars = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(vars);
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
