// Pull master data FROM SAP B1 into the app (reverse of the outbox direction).
// Suppliers live in B1 as BusinessPartners with CardType 'cSupplier'.
import { prisma } from './db';
import { getSapConfig, b1Request } from './connector';

type B1Partner = { CardCode: string; CardName: string; Valid?: string; Frozen?: string };

// Service Layer pages results (default 20 rows) and hands back an
// "odata.nextLink" relative to /b1s/v1/ — follow it until it runs out.
async function b1CollectAll(firstPath: string): Promise<any[]> {
  const cfg = await getSapConfig();
  const rows: any[] = [];
  let path: string | null = firstPath;
  while (path) {
    const page = await b1Request(cfg, 'GET', path);
    rows.push(...(page.value ?? []));
    path = page['odata.nextLink'] ? `/b1s/v1/${page['odata.nextLink']}` : null;
    if (rows.length > 10000) throw new Error('More than 10,000 rows — narrow the filter.');
  }
  return rows;
}

export async function pullSuppliersFromB1(): Promise<{ fetched: number; created: number; updated: number; linked: number }> {
  const cfg = await getSapConfig();
  if (cfg.profile !== 'b1') throw new Error('Profile must be "b1" to pull from SAP.');

  // only groups that supply raw material belong in the intake dropdown —
  // HKU_PRD_NEW group 104 = "Raw Material". Override via sap.pullSupplierGroups (comma-separated codes; empty = all).
  const groupSetting = (await prisma.setting.findUnique({ where: { key: 'sap.pullSupplierGroups' } }))?.value ?? '104';
  const codes = groupSetting.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  const groupFilter = codes.length ? ` and (${codes.map((c) => `GroupCode eq ${c}`).join(' or ')})` : '';

  const partners: B1Partner[] = await b1CollectAll(
    `/b1s/v1/BusinessPartners?$select=CardCode,CardName,Valid,Frozen&$filter=CardType eq 'cSupplier'${groupFilter}&$orderby=CardCode`,
  );

  let created = 0, updated = 0, linked = 0;
  for (const p of partners) {
    const name = (p.CardName ?? '').trim() || p.CardCode;
    const active = p.Valid !== 'tNO' && p.Frozen !== 'tYES';

    const byCode = await prisma.supplier.findFirst({ where: { sapVendorCode: p.CardCode } });
    if (byCode) {
      // already linked — refresh name/active from B1 (B1 is the master)
      const sameName = await prisma.supplier.findUnique({ where: { name } });
      const safeName = sameName && sameName.id !== byCode.id ? `${name} (${p.CardCode})` : name;
      await prisma.supplier.update({ where: { id: byCode.id }, data: { name: safeName, active } });
      updated++;
      continue;
    }

    const byName = await prisma.supplier.findUnique({ where: { name } });
    if (byName && !byName.sapVendorCode) {
      // existing hand-entered supplier with the same name — link it to the B1 code
      await prisma.supplier.update({ where: { id: byName.id }, data: { sapVendorCode: p.CardCode, active } });
      linked++;
      continue;
    }

    // brand new; if the name is taken by a differently-coded supplier, disambiguate
    const finalName = byName ? `${name} (${p.CardCode})` : name;
    await prisma.supplier.create({ data: { name: finalName, sapVendorCode: p.CardCode, active } });
    created++;
  }

  return { fetched: partners.length, created, updated, linked };
}
