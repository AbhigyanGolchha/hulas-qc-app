/* eslint-disable no-console */
// Wipe every transactional record so the plant can start real testing from
// zero, while KEEPING everything that took effort to set up:
//   kept   : mills (incl. batch counters), products, parameters, spec versions,
//            suppliers (incl. the ones pulled from SAP), pack sizes, approval
//            stages, all settings (SAP connection, email, numbering formats)
//   wiped  : batches, intake / QC / production reports and their rows,
//            signatures, SAP outbox, email queue, retention samples, audit log,
//            report sequence counters, and every user except `admin`
//   admin  : kept, demo signature cleared, forced to choose a new password
//
//   npm run db:reset                 (asks for confirmation)
//   npm run db:reset -- --yes        (no prompt)
//   KEEP_USERS=1 npm run db:reset    keep all user accounts (only their demo signatures are cleared)
import { PrismaClient } from '@prisma/client';
import { createInterface } from 'readline';

const prisma = new PrismaClient();

async function confirm(): Promise<boolean> {
  if (process.argv.includes('--yes')) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question('This deletes ALL reports, batches, signatures and non-admin users. Type "reset" to continue: ', (a) => { rl.close(); res(a.trim() === 'reset'); }));
}

async function main() {
  const counts = {
    intake: await prisma.intakeReport.count(),
    qc: await prisma.qcReport.count(),
    production: await prisma.productionReport.count(),
    batches: await prisma.batch.count(),
    users: await prisma.user.count(),
  };
  console.log('Current data:', counts);
  if (!(await confirm())) {
    console.log('Aborted — nothing changed.');
    return;
  }

  // children first (SQLite has no cascade for the non-relation tables)
  await prisma.signature.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.integrationOutbox.deleteMany();
  await prisma.downtimeEntry.deleteMany();
  await prisma.productionInput.deleteMany();
  await prisma.productionRow.deleteMany();
  await prisma.productionReport.deleteMany();
  await prisma.qcResult.deleteMany();
  await prisma.qcReport.deleteMany();
  await prisma.intakeResult.deleteMany();
  await prisma.intakeReport.deleteMany();
  await prisma.retentionSample.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: 'seq.' } } });

  const keepUsers = process.env.KEEP_USERS === '1';
  if (!keepUsers) {
    const gone = await prisma.user.deleteMany({ where: { username: { not: 'admin' } } });
    console.log(`Removed ${gone.count} user account(s); kept admin.`);
  }
  // demo cursive signatures are not real signatures — everyone draws their own
  await prisma.user.updateMany({ data: { signatureData: null, failedLogins: 0, lockedUntil: null } });
  await prisma.user.updateMany({ where: { username: 'admin' }, data: { mustChangePassword: true } });

  await prisma.auditLog.create({
    data: { userName: 'reset script', recordType: 'MASTER', recordId: 'reset', action: 'RESET', newValue: `wiped ${counts.intake} intake, ${counts.qc} QC, ${counts.production} production reports, ${counts.batches} batches; master data + settings kept` },
  });
  console.log('Done. Master data, suppliers, SAP + email settings kept. Admin must choose a new password at next sign-in.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
