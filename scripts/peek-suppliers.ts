/* eslint-disable no-console */
// read-only: preview what "Pull suppliers from SAP" would import (no DB writes)
import { getSapConfig, b1Request } from '../src/lib/connector';
import { prisma } from '../src/lib/db';

async function main() {
  const cfg = await getSapConfig();
  const page = await b1Request(
    cfg,
    'GET',
    "/b1s/v1/BusinessPartners?$select=CardCode,CardName,Valid,Frozen&$filter=CardType eq 'cSupplier'&$orderby=CardCode&$inlinecount=allpages",
  );
  console.log('total suppliers in B1:', page['odata.count'] ?? '(count not returned)');
  for (const p of (page.value ?? []).slice(0, 10)) {
    console.log(`  ${p.CardCode}  ${p.CardName}  valid=${p.Valid} frozen=${p.Frozen}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
