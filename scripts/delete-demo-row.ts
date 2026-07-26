/* eslint-disable no-console */
// One-time cleanup: remove the demo row SA-2083-0002 from @HULAS_QC in B1,
// then list what remains. Touches nothing else.
import { getSapConfig, b1Request } from '../src/lib/connector';
import { prisma } from '../src/lib/db';

async function main() {
  const cfg = await getSapConfig();
  await b1Request(cfg, 'DELETE', "/b1s/v1/HULAS_QC('SA-2083-0002')");
  console.log('✓ deleted SA-2083-0002');
  const page = await b1Request(cfg, 'GET', '/b1s/v1/HULAS_QC?$select=Code,U_RecType,U_Result&$orderby=Code');
  console.log('rows remaining in @HULAS_QC:');
  for (const r of page.value ?? []) console.log(`  ${r.Code} | ${r.U_RecType} | ${r.U_Result}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
