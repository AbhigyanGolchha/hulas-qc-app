/* eslint-disable no-console */
// One-time SAP B1 provisioning: creates the HULAS_QC user table, its fields,
// and registers the master-data UDO the connector posts to.
//
//   1. Fill Admin → SAP connection (profile b1, base URL, user, CompanyDB).
//   2. Run: npm run b1:provision
//
// Safe to re-run — "already exists" answers are treated as success.
// The Service Layer user needs authorization for customization objects
// (UserTablesMD / UserFieldsMD / UserObjectsMD) — usually a superuser does this once.
import { getSapConfig, b1Request } from '../src/lib/connector';
import { prisma } from '../src/lib/db';

const TABLE = 'HULAS_QC';

const FIELDS: Array<{ Name: string; Type: string; Size?: number; SubType?: string; Description: string }> = [
  { Name: 'RecType', Type: 'db_Alpha', Size: 20, Description: 'INTAKE / PRODUCT_QC / PRODUCTION' },
  { Name: 'RecDate', Type: 'db_Alpha', Size: 10, Description: 'Date (AD, YYYY-MM-DD)' },
  { Name: 'MitiBS', Type: 'db_Alpha', Size: 10, Description: 'Date (BS)' },
  { Name: 'Material', Type: 'db_Alpha', Size: 50, Description: 'Material / product (ItemCode when mapped)' },
  { Name: 'CardCode', Type: 'db_Alpha', Size: 15, Description: 'Supplier CardCode' },
  { Name: 'BatchNo', Type: 'db_Alpha', Size: 36, Description: 'Hulas batch number' },
  { Name: 'Result', Type: 'db_Alpha', Size: 30, Description: 'PASS/FAIL or intake decision' },
  { Name: 'Remarks', Type: 'db_Alpha', Size: 254, Description: 'Remarks' },
  // intake pricing — NPR, price per quintal (100 kg); GRPO is priced at EffRateQtl
  { Name: 'PriceQtl', Type: 'db_Float', SubType: 'st_Price', Description: 'Base rate agreed (NPR/quintal)' },
  { Name: 'WtCutKg', Type: 'db_Float', SubType: 'st_Quantity', Description: 'Weight cut / katti (kg)' },
  { Name: 'PriceCutQtl', Type: 'db_Float', SubType: 'st_Price', Description: 'Price cut (NPR/quintal)' },
  { Name: 'FlatDed', Type: 'db_Float', SubType: 'st_Sum', Description: 'Flat deduction (NPR)' },
  { Name: 'TotalDed', Type: 'db_Float', SubType: 'st_Sum', Description: 'Total deduction (NPR)' },
  { Name: 'PayableKg', Type: 'db_Float', SubType: 'st_Quantity', Description: 'Payable weight (kg)' },
  { Name: 'PayableVal', Type: 'db_Float', SubType: 'st_Sum', Description: 'Amount payable to supplier (NPR)' },
  { Name: 'EffRateQtl', Type: 'db_Float', SubType: 'st_Price', Description: 'Effective rate (NPR/quintal) — GRPO unit price basis' },
  { Name: 'Payload', Type: 'db_Memo', Description: 'Full report JSON' },
];

async function tolerate(label: string, fn: () => Promise<any>) {
  try {
    await fn();
    console.log(`✓ ${label}`);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('already exist') || msg.includes('-2035') || msg.includes('-1120')) {
      console.log(`• ${label} — already exists, skipping`);
    } else {
      throw e;
    }
  }
}

async function main() {
  const cfg = await getSapConfig();
  if (cfg.profile !== 'b1') {
    console.error(`Profile is "${cfg.profile}" — set it to "b1" in Admin → SAP connection first.`);
    process.exit(1);
  }
  if (!cfg.baseUrl || !cfg.username || !cfg.client) {
    console.error('Base URL, user and CompanyDB must be configured in Admin → SAP connection first.');
    process.exit(1);
  }
  console.log(`Provisioning ${TABLE} on ${cfg.baseUrl} (CompanyDB ${cfg.client})…`);

  await tolerate(`user table @${TABLE}`, () =>
    b1Request(cfg, 'POST', '/b1s/v1/UserTablesMD', {
      TableName: TABLE,
      TableDescription: 'Hulas QC & production records',
      TableType: 'bott_MasterData',
    }),
  );

  for (const f of FIELDS) {
    await tolerate(`field U_${f.Name}`, () =>
      b1Request(cfg, 'POST', '/b1s/v1/UserFieldsMD', { ...f, TableName: `@${TABLE}` }),
    );
  }

  await tolerate(`UDO ${TABLE}`, () =>
    b1Request(cfg, 'POST', '/b1s/v1/UserObjectsMD', {
      Code: TABLE,
      Name: 'Hulas QC Records',
      ObjectType: 'boud_MasterData',
      TableName: TABLE,
      CanCancel: 'tNO',
      CanClose: 'tNO',
      CanCreateDefaultForm: 'tNO',
      CanDelete: 'tYES',
      CanFind: 'tYES',
      CanLog: 'tNO',
      CanYearTransfer: 'tNO',
      ManageSeries: 'tNO',
    }),
  );

  console.log(`\nDone. Test with: Admin → SAP connection → "Test connection", then "Sync now".`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Provisioning failed:', e);
  process.exit(1);
});
