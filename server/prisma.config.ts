import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations use the direct (non-pooled) URL; the app uses DATABASE_URL via the pg adapter.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
