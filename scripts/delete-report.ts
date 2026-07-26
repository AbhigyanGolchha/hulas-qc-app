/* eslint-disable no-console */
// Testing-phase cleanup: fully remove a report from the APP database by its
// report number — the report row, its results (cascade), signatures, queue
// rows, and audit trail. Does NOT touch SAP (use delete-row.ts for that).
//
//   npx tsx scripts/delete-report.ts SA-2083-0009 [more report numbers…]
//
// Intentionally a script and not a button: the app UI must never delete.
import { prisma } from '../src/lib/db';

const MODELS = {
  SA: { name: 'intake', recordType: 'INTAKE', find: (no: string) => prisma.intakeReport.findUnique({ where: { reportNo: no } }), del: (id: string) => prisma.intakeReport.delete({ where: { id } }) },
  QC: { name: 'product QC', recordType: 'QC', find: (no: string) => prisma.qcReport.findUnique({ where: { reportNo: no } }), del: (id: string) => prisma.qcReport.delete({ where: { id } }) },
  DP: { name: 'production', recordType: 'PRODUCTION', find: (no: string) => prisma.productionReport.findUnique({ where: { reportNo: no } }), del: (id: string) => prisma.productionReport.delete({ where: { id } }) },
} as const;

async function main() {
  const nos = process.argv.slice(2);
  if (!nos.length) {
    console.error('Usage: npx tsx scripts/delete-report.ts <report-no> [more…]   e.g. SA-2083-0009 SA-2083-0010');
    process.exit(1);
  }
  for (const no of nos) {
    const kind = MODELS[no.slice(0, 2).toUpperCase() as keyof typeof MODELS];
    if (!kind) { console.error(`✗ ${no}: unknown prefix (expected SA-/QC-/DP-)`); continue; }
    const report = await kind.find(no);
    if (!report) { console.error(`✗ ${no}: not found`); continue; }
    const sigs = await prisma.signature.deleteMany({ where: { recordType: kind.recordType, recordId: report.id } });
    const outbox = await prisma.integrationOutbox.deleteMany({ where: { recordId: report.id } });
    const audit = await prisma.auditLog.deleteMany({ where: { recordType: kind.recordType, recordId: report.id } });
    await kind.del(report.id);
    console.log(`✓ ${no} (${kind.name}) deleted — ${sigs.count} signature(s), ${outbox.count} queue row(s), ${audit.count} audit row(s) removed with it`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
