/* eslint-disable no-console */
// read-only: list B1 business partner groups and supplier counts per group
import { getSapConfig, b1Request } from '../src/lib/connector';
import { prisma } from '../src/lib/db';

async function main() {
  const cfg = await getSapConfig();
  const groups = await b1Request(cfg, 'GET', '/b1s/v1/BusinessPartnerGroups?$select=Code,Name,Type');
  for (const g of groups.value ?? []) {
    let count = '';
    try {
      const c = await b1Request(
        cfg,
        'GET',
        `/b1s/v1/BusinessPartners/$count?$filter=CardType eq 'cSupplier' and GroupCode eq ${g.Code}`,
      );
      count = String(c);
    } catch {
      count = '?';
    }
    console.log(`${String(g.Code).padStart(4)}  ${String(g.Name).padEnd(35)} type=${g.Type}  suppliers=${count}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
