/* eslint-disable no-console */
// Delete one row from @HULAS_QC in B1 by its Code, then list what remains.
//   npx tsx scripts/delete-row.ts SA-2083-0009
import { getSapConfig, b1Request } from '../src/lib/connector';
import { prisma } from '../src/lib/db';

async function main() {
  const code = process.argv[2];
  if (!code) {
    console.error('Usage: npx tsx scripts/delete-row.ts <Code>   e.g. SA-2083-0009');
    process.exit(1);
  }
  const cfg = await getSapConfig();
  await b1Request(cfg, 'DELETE', `/b1s/v1/HULAS_QC('${encodeURIComponent(code)}')`);
  console.log(`✓ deleted ${code}`);
  const page = await b1Request(cfg, 'GET', '/b1s/v1/HULAS_QC?$select=Code,U_RecType,U_Result&$orderby=Code');
  const rows = page.value ?? [];
  console.log(rows.length ? 'rows remaining in @HULAS_QC:' : '@HULAS_QC is now empty.');
  for (const r of rows) console.log(`  ${r.Code} | ${r.U_RecType} | ${r.U_Result}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
