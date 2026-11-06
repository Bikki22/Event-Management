import { Algorithm, hash, verify } from "@node-rs/argon2";

// argon2id, OWASP minimum: m = 19 MiB, t = 2, p = 1
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false; // malformed hash: treat as mismatch, never throw to the caller
  }
}

// A real hash of a random value, computed once. Verifying against it when the user doesn't exist
// makes login take the same time for unknown emails (no account enumeration via timing).
let dummyHash: Promise<string> | undefined;
export async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(crypto.randomUUID());
  await verifyPassword(await dummyHash, password);
  return false;
}
