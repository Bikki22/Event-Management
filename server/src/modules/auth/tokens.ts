import {
  errors as joseErrors,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey,
} from "jose";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { Unauthorized } from "../../lib/errors.js";
import type { UserRole } from "../../generated/prisma/enums.js";

const ALG = "EdDSA";

export interface AccessClaims {
  userId: string;
  role: UserRole;
  sessionId: string;
}

let keys: Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> | undefined;
const getKeys = () =>
  (keys ??= Promise.all([
    importPKCS8(env.JWT_PRIVATE_KEY, ALG),
    importSPKI(env.JWT_PUBLIC_KEY, ALG),
  ]).then(([privateKey, publicKey]) => ({ privateKey, publicKey })));

/** Short-lived (ACCESS_TOKEN_TTL_SECONDS) Ed25519-signed JWT. */
export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const { privateKey } = await getKeys();
  return new SignJWT({ role: claims.role, sid: claims.sessionId })
    .setProtectedHeader({ alg: ALG, kid: env.JWT_KEY_ID, typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

/** Verifies signature, alg, iss, aud and exp. Throws 401 TOKEN_EXPIRED / TOKEN_INVALID. */
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { publicKey } = await getKeys();
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: [ALG],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      throw new Error("missing claims");
    }
    return { userId: payload.sub, sessionId: payload.sid, role: payload.role as UserRole };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw Unauthorized("TOKEN_EXPIRED", "Access token expired");
    }
    throw Unauthorized("TOKEN_INVALID", "Invalid access token");
  }
}

/** Opaque refresh token: raw value goes to the cookie, only the hash goes to the DB. */
export function newRefreshToken(sessionExpiresAt: Date): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  const raw = randomToken(32);
  const sliding = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  // never outlive the session's absolute cap
  const expiresAt = sliding < sessionExpiresAt ? sliding : sessionExpiresAt;
  return { raw, hash: sha256(raw), expiresAt };
}
