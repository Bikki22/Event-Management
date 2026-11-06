/**
 * Generates an Ed25519 key pair for signing access tokens and prints .env lines.
 *   npm run keys:generate            → print to stdout
 *   npm run keys:generate -- --write → also replace JWT_* lines in .env
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const oneLine = (pem: string) => pem.trim().replace(/\n/g, "\\n");
const kid = `k-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;

const lines = {
  JWT_PRIVATE_KEY: `"${oneLine(privateKey)}"`,
  JWT_PUBLIC_KEY: `"${oneLine(publicKey)}"`,
  JWT_KEY_ID: kid,
};
const block = Object.entries(lines)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");

// Data-encryption key: only generated when .env has none. Replacing it would make existing
// encrypted rows unreadable; rotate by moving the old key to DATA_ENCRYPTION_OLD_KEYS first.
const dataKeyLine = `DATA_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\nDATA_ENCRYPTION_KEY_ID=k1`;

if (process.argv.includes("--write")) {
  const path = ".env";
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  content = content.replace(/^JWT_(PRIVATE_KEY|PUBLIC_KEY|KEY_ID)=.*\r?\n?/gm, "");
  content = content.trimEnd() + "\n\n# ---- JWT (generated) ----\n" + block + "\n";
  const hasDataKey = /^DATA_ENCRYPTION_KEY=[0-9a-f]{64}\s*$/im.test(content);
  if (!hasDataKey) {
    content = content.replace(/^DATA_ENCRYPTION_KEY(_ID)?=.*\r?\n?/gm, "");
    content += "\n# ---- Encryption at rest (generated) ----\n" + dataKeyLine + "\n";
  }
  writeFileSync(path, content);
  console.log(`Wrote new JWT key pair (kid=${kid}) to ${path}`);
  if (!hasDataKey) console.log("Wrote a new DATA_ENCRYPTION_KEY");
} else {
  console.log(block + "\n" + dataKeyLine);
}
