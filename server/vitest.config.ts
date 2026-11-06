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
      EMAIL_DRIVER: "console",
      CORS_ORIGINS: "http://localhost:5173",
      FRONTEND_URL: "http://localhost:5173",
    },
  },
});
