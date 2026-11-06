import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

const log = logger.child({ module: "auth" });
const DAY = 86_400_000;

/** Daily cleanup of auth rows nobody can use anymore. Idempotent. */
export async function purgeExpiredAuthData(): Promise<void> {
  const now = Date.now();
  const [tokens, sessions, links] = await prisma.$transaction([
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(now - DAY) } } }),
    // keep revoked/expired sessions 30 days for the "devices" history and investigations
    prisma.authSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now - 30 * DAY) } },
          { revokedAt: { lt: new Date(now - 30 * DAY) } },
        ],
      },
    }),
    prisma.verificationToken.deleteMany({ where: { expiresAt: { lt: new Date(now - DAY) } } }),
  ]);
  log.info(
    { refreshTokens: tokens.count, sessions: sessions.count, verificationTokens: links.count },
    "purged expired auth data",
  );
}
