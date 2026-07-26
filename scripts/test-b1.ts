/* eslint-disable no-console */
// throwaway: end-to-end test of the B1 connector against the fake Service Layer
import { prisma } from '../src/lib/db';
import { exportToOutbox } from '../src/lib/sap';
import { deliverRow, testConnection } from '../src/lib/connector';

async function set(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function main() {
  // snapshot whatever config is live so cleanup can put it back exactly
  const saved = await prisma.setting.findMany({ where: { key: { startsWith: 'sap.' } } });

  // point the connector at the fake Service Layer
  await set('sap.profile', 'b1');
  await set('sap.baseUrl', 'http://localhost:5999');
  await set('sap.username', 'hulas_tech');
  await set('sap.password', 'secret');
  await set('sap.client', 'HULAS_TEST');

  console.log('test connection →', await testConnection());

  // 1) QC report → UDO row
  const qc = await prisma.qcReport.findUniqueOrThrow({ where: { reportNo: 'QC-2083-0003' } });
  await exportToOutbox('QC', qc.id);
  let row = await prisma.integrationOutbox.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  console.log('QC delivery →', await deliverRow(row.id));

  // 2) intake → UDO row
  const intake = await prisma.intakeReport.findUniqueOrThrow({ where: { reportNo: 'SA-2083-0001' } });
  await exportToOutbox('INTAKE', intake.id);
  row = await prisma.integrationOutbox.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  console.log('intake delivery →', await deliverRow(row.id));

  // 3) production in UDO mode
  const prod = await prisma.productionReport.findUniqueOrThrow({ where: { reportNo: 'DP-2083-0001' } });
  await set('sap.b1ProductionMode', 'udo');
  await exportToOutbox('PRODUCTION', prod.id);
  row = await prisma.integrationOutbox.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  console.log('production (udo) →', await deliverRow(row.id));

  // 4) production in documents mode — needs order no + item codes
  await set('sap.b1ProductionMode', 'documents');
  await prisma.batch.update({ where: { millId_batchNo: { millId: prod.millId, batchNo: 'RFM-193' } }, data: { sapOrderNo: '4711' } });
  await prisma.product.updateMany({ where: { millId: prod.millId }, data: { sapMaterialCode: 'ITEM-GEN' } });
  await exportToOutbox('PRODUCTION', prod.id);
  row = await prisma.integrationOutbox.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  console.log('production (documents) →', await deliverRow(row.id));

  // ---- cleanup: back to pre-test state ----
  await prisma.integrationOutbox.deleteMany({ where: { sapDocNo: { not: { startsWith: 'MOCK' } } } });
  await prisma.batch.update({ where: { millId_batchNo: { millId: prod.millId, batchNo: 'RFM-193' } }, data: { sapOrderNo: null } });
  await prisma.product.updateMany({ where: { millId: prod.millId }, data: { sapMaterialCode: null } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: 'sap.' }, NOT: { key: { in: saved.map((r) => r.key) } } } });
  for (const row of saved) await set(row.key, row.value);
  console.log('cleaned up — config restored, test rows removed');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
