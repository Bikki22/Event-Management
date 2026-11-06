import { generateKeyPairSync, randomBytes } from "node:crypto";
import { defineConfig } from "vitest/config";

// Fresh signing keys per test run: no secrets in files.
const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

// Integration tests use the docker-compose Postgres/Redis, but a separate DB and Redis index.
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://ems:ems@localhost:5432/ems_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false, // shared DB
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: TEST_DB,
      DIRECT_URL: TEST_DB,
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1",
      JWT_PRIVATE_KEY: privateKey,
      JWT_PUBLIC_KEY: publicKey,
      JWT_KEY_ID: "test",
      DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      DATA_ENCRYPTION_KEY_ID: "test",
      S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "http://localhost:9000",
      S3_BUCKET: "ems-test",
      S3_ACCESS_KEY_ID: "ems",
      S3_SECRET_ACCESS_KEY: "ems-storage-secret",
      S3_PUBLIC_URL: "http://localhost:9000/ems-test",
      EMAIL_DRIVER: "console",
      PAYMENT_MOCK_ENABLED: "true",
      PAYMENT_RETURN_URL: "http://localhost:5173/payments/return",
      KHALTI_SECRET_KEY: "test-khalti-secret",
      KHALTI_BASE_URL: "https://khalti.test/api/v2",
      ESEWA_PRODUCT_CODE: "EPAYTEST",
      ESEWA_SECRET_KEY: "8gBm/:&EnhH.1/q",
      ESEWA_FORM_URL: "https://esewa.test/api/epay/main/v2/form",
      ESEWA_STATUS_URL: "https://esewa.test/api/epay/transaction/status/",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
      STRIPE_API_BASE: "https://stripe.test",
      METRICS_TOKEN: "test-metrics-token-123",
      CORS_ORIGINS: "http://localhost:5173",
      FRONTEND_URL: "http://localhost:5173",
    },
  },
});
