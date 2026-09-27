/* eslint-disable no-console */
// Last-resort password reset from the server's shell — for when the only
// Admin is locked out and email isn't set up, so nobody can use the app's
// own reset. Gives the account a temporary password it must change on sign-in.
//
//   npm run user:reset -- <username>
import { PrismaClient } from '@prisma/client';
import { hashPassword, generateTempPassword } from '../src/lib/auth';

const prisma = new PrismaClient();

(async () => {
  const username = (process.argv[2] || '').trim().toLowerCase();
  if (!username) {
    console.error('Usage: npm run user:reset -- <username>');
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No user "${username}".`);
    process.exit(1);
  }
  const temp = generateTempPassword();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(temp), mustChangePassword: true, failedLogins: 0, lockedUntil: null, active: true } });
  await prisma.auditLog.create({ data: { userName: 'server shell', recordType: 'AUTH', recordId: user.id, action: 'PASSWORD_RESET', newValue: 'reset from the server command line (npm run user:reset)' } });
  console.log(`Temporary password for ${user.name} (${username}): ${temp}`);
  console.log('They must choose their own password at the next sign-in.');
  await prisma.$disconnect();
})();
