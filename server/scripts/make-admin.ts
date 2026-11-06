/**
 * Promotes an existing account to admin (there is no API to create the first admin).
 *   npm run user:make-admin -- someone@example.com
 */
import { writeAudit } from "../src/lib/audit.js";
import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import { invalidateUserState } from "../src/modules/auth/session-state.js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run user:make-admin -- <email>");
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}. Register the account first.`);
    process.exitCode = 1;
  } else if (user.role === "admin") {
    console.log(`${user.email} is already an admin.`);
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { role: "admin" } });
      await writeAudit(
        {
          actorId: null,
          action: "admin.user_promoted_cli",
          entityType: "user",
          entityId: user.id,
          ip: null,
          diff: { before: { role: user.role }, after: { role: "admin" } },
        },
        tx,
      );
    });
    await invalidateUserState(user.id);
    console.log(`${user.email} is now an admin.`);
  }
} finally {
  await prisma.$disconnect();
  redis.disconnect();
}
