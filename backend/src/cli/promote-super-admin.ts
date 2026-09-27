/**
 * Bootstraps the first super admin (the API never grants super_admin).
 *
 *   npm run build && npm run admin:promote -- someone@example.com
 *
 * Promotes an existing account (sign up and verify it first). Existing
 * sessions are revoked in Postgres so the next login carries the new role.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { PrismaClient } from '../generated/prisma/client.js';

async function main() {
  // Fill gaps from .env without overriding the real environment (e.g. Docker).
  try {
    const fromFile = parseEnv(readFileSync('.env', 'utf8'));
    for (const [key, value] of Object.entries(fromFile)) {
      process.env[key] ??= value;
    }
  } catch {
    // No .env file: rely on the real environment.
  }

  const email = process.argv[2]?.trim().toLowerCase();
  const url = process.env.DATABASE_URL;
  if (!email) throw new Error('Usage: npm run admin:promote -- <email>');
  if (!url) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
    if (!user) {
      throw new Error(`No account for ${email}. Sign up (and verify) first.`);
    }
    if (user.role === 'super_admin') {
      console.log(`${email} is already a super admin.`);
      return;
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { role: 'super_admin' },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    console.log(
      `${email} is now a super admin (was ${user.role}). Log in again to use the admin console.`,
    );
    if (user.status !== 'active') {
      console.warn(`Note: the account status is "${user.status}".`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
