import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * App-level encryption for sensitive columns (backend.md §10: AES-256-GCM, key id next to the
 * ciphertext so keys can be rotated). New data is written with DATA_ENCRYPTION_KEY; old rows stay
 * readable as long as their key is listed in DATA_ENCRYPTION_OLD_KEYS.
 *
 * `aad` (additional authenticated data) binds a ciphertext to its row, e.g. "payout:<userId>".
 * Copying one row's ciphertext into another row then fails to decrypt instead of leaking.
 */

export interface EncryptedBlob {
  v: 1;
  kid: string;
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16 bytes
  ct: string; // base64
}

const ALGO = "aes-256-gcm";

const keys = new Map<string, Buffer>();
keys.set(env.DATA_ENCRYPTION_KEY_ID, Buffer.from(env.DATA_ENCRYPTION_KEY, "hex"));
for (const entry of env.DATA_ENCRYPTION_OLD_KEYS.split(",").filter(Boolean)) {
  const [kid, hex] = entry.trim().split(":");
  if (!kid || !hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("DATA_ENCRYPTION_OLD_KEYS must look like id:<64 hex>,id:<64 hex>");
  }
  if (!keys.has(kid)) keys.set(kid, Buffer.from(hex, "hex"));
}

export function encryptJson(value: unknown, aad: string): EncryptedBlob {
  const kid = env.DATA_ENCRYPTION_KEY_ID;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keys.get(kid)!, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    v: 1,
    kid,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
}

export function decryptJson<T>(blob: unknown, aad: string): T {
  const b = blob as Partial<EncryptedBlob> | null;
  if (!b || b.v !== 1 || !b.kid || !b.iv || !b.tag || !b.ct) {
    throw new Error("not an encrypted blob");
  }
  const key = keys.get(b.kid);
  if (!key) throw new Error(`unknown encryption key id: ${b.kid}`);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(b.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(b.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(b.ct, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

/** True when the blob was written with an old key (re-encrypt on next write). */
export const needsReencryption = (blob: unknown): boolean =>
  (blob as Partial<EncryptedBlob> | null)?.kid !== env.DATA_ENCRYPTION_KEY_ID;
