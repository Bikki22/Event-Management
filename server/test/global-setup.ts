import { execSync } from "node:child_process";
import pg from "pg";

/** Creates the test database if needed and applies all migrations once per run. */
export default async function setup() {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://ems:ems@localhost:5432/ems_test");
  const dbName = url.pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      dbName,
    ]);
    if (!rowCount) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
  } finally {
    await client.end();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DIRECT_URL: url.toString(), DATABASE_URL: url.toString() },
  });
}
