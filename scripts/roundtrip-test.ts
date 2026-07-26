/* eslint-disable no-console */
// Proof that @HULAS_QC rows are fully deletable: create one obviously-fake
// test row, read it back, delete it, confirm it is gone. Touches nothing else.
import { getSapConfig, b1Request } from '../src/lib/connector';
import { prisma } from '../src/lib/db';

const CODE = 'TEST-DELETE-ME';

async function main() {
  const cfg = await getSapConfig();

  console.log('1. creating test row…');
  await b1Request(cfg, 'POST', '/b1s/v1/HULAS_QC', {
    Code: CODE,
    Name: CODE,
    U_RecType: 'TEST',
    U_Result: 'TEST',
    U_Remarks: 'Roundtrip test from Hulas QC app — safe to ignore, deletes itself.',
  });
  console.log('   ✓ created');

  console.log('2. reading it back…');
  const row = await b1Request(cfg, 'GET', `/b1s/v1/HULAS_QC('${CODE}')`);
  console.log(`   ✓ found: Code=${row.Code} U_RecType=${row.U_RecType} U_Remarks="${row.U_Remarks}"`);

  console.log('3. deleting it…');
  await b1Request(cfg, 'DELETE', `/b1s/v1/HULAS_QC('${CODE}')`);
  console.log('   ✓ delete accepted');

  console.log('4. confirming it is gone…');
  try {
    await b1Request(cfg, 'GET', `/b1s/v1/HULAS_QC('${CODE}')`);
    console.log('   ✗ STILL THERE — deletion did not work!');
    process.exit(1);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('404') || msg.toLowerCase().includes('not found') || msg.includes('-2028')) {
      console.log('   ✓ gone — B1 says the row no longer exists.');
    } else {
      throw e;
    }
  }

  console.log('\nRoundtrip complete: rows in @HULAS_QC are created AND deleted cleanly.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Roundtrip failed:', e);
  process.exit(1);
});
