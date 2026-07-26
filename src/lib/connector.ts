// SAP connector: drains the integration_outbox and delivers each payload to
// the configured SAP system. Three profiles:
//
//   mock    — no SAP needed; validates the payload, marks SENT with a MOCK-…
//             doc number. Default, so the whole flow is demo-able today.
//   s4hana  — S/4HANA (or ECC + Gateway) OData v2 APIs:
//             QM inspection lots  → API_INSPECTIONLOT_SRV
//             prod confirmations  → API_PROD_ORDER_CONFIRMATION_2_SRV
//             Handles CSRF token fetch + session cookies, basic auth.
//   b1      — SAP Business One Service Layer (Hulas Group runs B1).
//             B1 has no QM module, so:
//               intake + QC   → rows in the HULAS_QC UDO (create it once with
//                               `npm run b1:provision`)
//               production    → either HULAS_QC UDO rows ("udo" mode, default:
//                               works before item codes are mapped) or real
//                               Issue-for-Production + Receipt-from-Production
//                               documents against the batch's production order
//                               ("documents" mode).
//             Sessions are cached ~25 min (B1 session limit is 30).
//
// ⚠ Field mappings inside the transform functions are the standard-API
// starting point. Finalize them with the SAP consultant against the real
// system before going live — they are isolated here on purpose.
import { prisma } from './db';

export type SapConfig = {
  profile: 'mock' | 's4hana' | 'b1';
  baseUrl: string;
  username: string;
  password: string;
  client: string; // sap-client for S/4, CompanyDB for B1
  pathInspectionLot: string;
  pathConfirmation: string;
  autoSend: boolean; // deliver immediately on approval (queue still records everything)
  // B1-only knobs
  b1ProductionMode: 'udo' | 'documents'; // UDO rows (safe default) vs real Issue/Receipt-for-Production docs
  b1SendBatches: boolean; // include BatchNumbers on receipt lines (batch-managed items)
};

const DEFAULTS: Record<string, Partial<SapConfig>> = {
  s4hana: {
    pathInspectionLot: '/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLot',
    pathConfirmation: '/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/ProdnOrdConf2',
  },
  b1: {
    // HULAS_QC is a master-data UDO created by `npm run b1:provision`
    pathInspectionLot: '/b1s/v1/HULAS_QC',
    pathConfirmation: '/b1s/v1/HULAS_QC', // used in "udo" mode; "documents" mode posts to InventoryGenExits/Entries
  },
  mock: { pathInspectionLot: '', pathConfirmation: '' },
};

export async function getSapConfig(): Promise<SapConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'sap.' } } });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const profile = (s['sap.profile'] as SapConfig['profile']) || 'mock';
  const d = DEFAULTS[profile] ?? {};
  return {
    profile,
    // people paste Service Layer URLs with the /b1s/vN path attached — the
    // connector adds its own paths, so strip any trailing slash and /b1s/vN
    baseUrl: (s['sap.baseUrl'] ?? '').replace(/\/+$/, '').replace(/\/b1s\/v\d+$/i, ''),
    username: s['sap.username'] ?? '',
    // env var wins so the password can stay out of the database entirely
    password: process.env.SAP_PASSWORD || s['sap.password'] || '',
    client: s['sap.client'] ?? '',
    pathInspectionLot: s['sap.pathInspectionLot'] || d.pathInspectionLot || '',
    pathConfirmation: s['sap.pathConfirmation'] || d.pathConfirmation || '',
    autoSend: s['sap.autoSend'] === 'true',
    b1ProductionMode: s['sap.b1ProductionMode'] === 'documents' ? 'documents' : 'udo',
    b1SendBatches: s['sap.b1SendBatches'] !== 'false',
  };
}

// ---------- transforms: outbox payload → SAP request body ----------

// QM inspection lot (S/4 standard API shape). Results/characteristics are
// carried in a summarized long text; per-characteristic results recording
// needs QM master data (inspection plans) and is a phase-2 mapping.
function toS4InspectionLot(p: any) {
  return {
    InspectionLotOrigin: p.inspection_lot_origin, // 01 goods receipt, 04 from production
    Material: p.material?.code ?? '',
    Plant: p.plant?.code ?? '',
    Supplier: p.vendor?.code ?? undefined,
    Batch: p.batch?.number ?? undefined,
    InspLotQuantity: String(p.quantity?.value ?? ''),
    InspectionLotQuantityUnit: p.quantity?.unit ?? 'KG',
    InspLotUsageDecisionCode: p.usage_decision?.decision === 'REJECTED' ? 'R' : p.usage_decision?.decision ? 'A' : undefined,
    InspectionLotText: `${p.report_no} — ${p.material?.name ?? ''}`.slice(0, 40),
    // full QC detail rides along for the middleware/consultant to map further
    _hulas_characteristics: p.characteristics,
    _hulas_signatures: p.signatures,
  };
}

function toS4Confirmation(p: any) {
  return {
    OrderID: p.batch?.sap_order_no ?? '', // set the SAP production order on the batch page
    Sequence: '0',
    ConfirmationText: `${p.report_no} batch ${p.batch?.number ?? ''}`.slice(0, 40),
    ConfirmationYieldQuantity: String(
      (p.goods_received ?? []).reduce(
        (a: number, g: any) => a + (g.semi_finished_kg ?? 0) + (g.packed ?? []).reduce((x: number, pk: any) => x + (pk.kg ?? 0), 0),
        0,
      ),
    ),
    ConfirmationUnit: 'KG',
    _hulas_goods_issued: p.goods_issued,
    _hulas_goods_received: p.goods_received,
    _hulas_downtime: p.downtime,
    _hulas_operations: p.operations,
  };
}

// ---------- B1 transforms ----------

// Intake/QC (and production in "udo" mode) → one HULAS_QC UDO row.
// Master-data UDOs key on Code/Name; the report number is a natural key.
function toB1UdoRow(p: any) {
  const isQm = p.record_type === 'SAP_QM_INSPECTION_LOT';
  const result = isQm
    ? p.usage_decision?.decision ?? p.usage_decision?.result ?? ''
    : 'PRODUCTION';
  return {
    Code: p.report_no,
    Name: p.report_no,
    U_RecType: isQm ? (p.inspection_lot_origin === '01' ? 'INTAKE' : 'PRODUCT_QC') : 'PRODUCTION',
    U_RecDate: p.dates?.date_ad ?? '',
    U_MitiBS: p.dates?.date_bs ?? '',
    U_Material: p.material?.code || p.material?.name || '',
    U_CardCode: p.vendor?.code || '',
    U_BatchNo: p.batch?.number ?? '',
    U_Result: String(result ?? ''),
    U_Remarks: String(p.usage_decision?.remarks ?? p.usage_decision?.reason ?? '').slice(0, 254),
    // pricing (intake only) — queryable columns so accounting can reconcile
    // the GRPO against the QC deduction without opening the JSON payload
    U_PriceQtl: p.pricing?.base_rate_per_quintal ?? null,
    U_WtCutKg: p.pricing?.deductions?.weight_cut_kg ?? null,
    U_PriceCutQtl: p.pricing?.deductions?.price_cut_per_quintal ?? null,
    U_FlatDed: p.pricing?.deductions?.flat_amount ?? null,
    U_TotalDed: p.pricing?.deductions?.total ?? null,
    U_PayableKg: p.pricing?.payable_weight_kg ?? null,
    U_PayableVal: p.pricing?.payable_value ?? null,
    U_EffRateQtl: p.pricing?.effective_rate_per_quintal ?? null,
    U_Payload: JSON.stringify(p), // full detail for reports/queries inside B1
  };
}

// "documents" mode: daily production → Issue for Production (inputs) +
// Receipt from Production (outputs) against the batch's production order.
// BaseType 202 = production order; BaseEntry = the order's DocEntry.
function toB1ProductionDocs(p: any, cfg: SapConfig) {
  const orderEntry = Number(p.batch?.sap_order_no);
  if (!orderEntry) {
    throw new Error(
      `Batch ${p.batch?.number ?? '?'} has no SAP production order number — set it on the batch page, or switch Admin → SAP connection to "udo" production mode.`,
    );
  }
  const issueLines = (p.goods_issued ?? [])
    .filter((g: any) => (g.net_kg ?? 0) > 0)
    .map((g: any) => ({
      BaseType: 202,
      BaseEntry: orderEntry,
      Quantity: g.net_kg,
      Remarks: g.invoice_no ? `Invoice ${g.invoice_no}` : undefined,
    }));
  const receiptLines = (p.goods_received ?? [])
    .map((g: any) => {
      const qty = (g.semi_finished_kg ?? 0) + (g.packed ?? []).reduce((a: number, x: any) => a + (x.kg ?? 0), 0);
      if (!qty) return null;
      if (!g.material?.code) {
        throw new Error(`Product "${g.material?.name}" has no SAP item code — fill it in Admin → Master data, or use "udo" production mode.`);
      }
      return {
        BaseType: 202,
        BaseEntry: orderEntry,
        ItemCode: g.material.code,
        Quantity: qty,
        ...(cfg.b1SendBatches
          ? { BatchNumbers: [{ BatchNumber: p.batch?.number ?? p.report_no, Quantity: qty }] }
          : {}),
      };
    })
    .filter(Boolean);
  return {
    issue: issueLines.length ? { DocDate: p.dates?.date_ad, Comments: `Hulas ${p.report_no}`, DocumentLines: issueLines } : null,
    receipt: receiptLines.length ? { DocDate: p.dates?.date_ad, Comments: `Hulas ${p.report_no}`, DocumentLines: receiptLines } : null,
  };
}

// ---------- HTTP plumbing ----------

async function s4Post(cfg: SapConfig, path: string, body: any): Promise<{ docNo: string }> {
  const url = cfg.baseUrl + path + (cfg.client ? `?sap-client=${cfg.client}` : '');
  const auth = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  // OData v2 write needs a CSRF token from a prior GET on the same session
  const tokenRes = await fetch(url, { method: 'GET', headers: { Authorization: auth, 'X-CSRF-Token': 'Fetch', Accept: 'application/json' } });
  const token = tokenRes.headers.get('x-csrf-token');
  const cookies = tokenRes.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ') ?? '';
  if (!token) throw new Error(`CSRF token fetch failed (HTTP ${tokenRes.status}) — check URL/credentials/authorizations`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'X-CSRF-Token': token, Cookie: cookies, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SAP rejected the document (HTTP ${res.status}): ${text.slice(0, 500)}`);
  const doc = JSON.parse(text)?.d ?? {};
  return { docNo: doc.InspectionLot ?? doc.OrderID ?? doc.Confirmation ?? 'created' };
}

// B1 sessions last 30 min — cache the cookie for ~25 and re-login as needed.
let b1Session: { cookie: string; expiresAt: number } | null = null;

export async function b1Login(cfg: SapConfig, force = false): Promise<string> {
  if (!force && b1Session && b1Session.expiresAt > Date.now()) return b1Session.cookie;
  const login = await fetch(cfg.baseUrl + '/b1s/v1/Login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ CompanyDB: cfg.client, UserName: cfg.username, Password: cfg.password }),
  });
  if (!login.ok) {
    b1Session = null;
    throw new Error(`B1 Service Layer login failed (HTTP ${login.status}) — check CompanyDB/user/password and that the user has a Service Layer-capable licence`);
  }
  const cookie = login.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ') ?? '';
  b1Session = { cookie, expiresAt: Date.now() + 25 * 60 * 1000 };
  return cookie;
}

export async function b1Request(cfg: SapConfig, method: string, path: string, body?: any): Promise<any> {
  let cookie = await b1Login(cfg);
  let res = await fetch(cfg.baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // session expired server-side — re-login once and retry
    cookie = await b1Login(cfg, true);
    res = await fetch(cfg.baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 500);
    try {
      msg = JSON.parse(text)?.error?.message?.value ?? msg;
    } catch { /* keep raw */ }
    throw new Error(`B1 ${method} ${path} → HTTP ${res.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : {};
}

async function b1Deliver(cfg: SapConfig, isQm: boolean, payload: any): Promise<{ docNo: string }> {
  if (isQm || cfg.b1ProductionMode === 'udo') {
    const path = isQm ? cfg.pathInspectionLot : cfg.pathConfirmation;
    const row = toB1UdoRow(payload);
    try {
      const doc = await b1Request(cfg, 'POST', path, row);
      return { docNo: String(doc.Code ?? doc.DocEntry ?? row.Code) };
    } catch (e) {
      // resent after an unlock/re-approval → update the existing row instead
      if (String(e).includes('already exists') || String(e).includes('-2035')) {
        await b1Request(cfg, 'PATCH', `${path}('${encodeURIComponent(row.Code)}')`, row);
        return { docNo: `${row.Code} (updated)` };
      }
      throw e;
    }
  }
  // documents mode: Issue for Production + Receipt from Production
  const docs = toB1ProductionDocs(payload, cfg);
  const parts: string[] = [];
  if (docs.issue) {
    const d = await b1Request(cfg, 'POST', '/b1s/v1/InventoryGenExits', docs.issue);
    parts.push(`Issue ${d.DocNum ?? d.DocEntry}`);
  }
  try {
    if (docs.receipt) {
      const d = await b1Request(cfg, 'POST', '/b1s/v1/InventoryGenEntries', docs.receipt);
      parts.push(`Receipt ${d.DocNum ?? d.DocEntry}`);
    }
  } catch (e) {
    // the issue doc already posted — surface that so nobody re-sends blindly
    throw new Error(`${parts.length ? `Posted ${parts.join(', ')} but then: ` : ''}${String(e)}. Reconcile in B1 before retrying.`);
  }
  if (!parts.length) throw new Error('Nothing to post — no inputs or outputs with quantities.');
  return { docNo: parts.join(' · ') };
}

// ---------- delivery engine ----------

const MAX_ATTEMPTS = 5;

export async function deliverRow(id: string): Promise<{ ok: boolean; docNo?: string; error?: string }> {
  const row = await prisma.integrationOutbox.findUnique({ where: { id } });
  if (!row || row.status === 'SENT') return { ok: true, docNo: row?.sapDocNo ?? undefined };
  const cfg = await getSapConfig();
  const payload = JSON.parse(row.payload);
  const isQm = row.recordType === 'SAP_QM_INSPECTION_LOT';

  // config incomplete = not a delivery failure: leave the row untouched (no
  // attempt burned) so the queue survives until IT hands over access
  if (cfg.profile !== 'mock' && !cfg.baseUrl) {
    return { ok: false, error: 'SAP base URL is not configured yet — row left pending, no attempt used.' };
  }

  try {
    let docNo: string;
    if (cfg.profile === 'mock') {
      // validate the essentials so mock mode still catches mapping gaps early
      const missing: string[] = [];
      if (isQm && !payload.material?.name) missing.push('material');
      if (!payload.report_no) missing.push('report_no');
      if (missing.length) throw new Error(`payload missing: ${missing.join(', ')}`);
      docNo = `MOCK-${row.id.slice(0, 8).toUpperCase()}`;
    } else if (cfg.profile === 's4hana') {
      if (!cfg.baseUrl) throw new Error('SAP base URL is not configured');
      const r = await s4Post(cfg, isQm ? cfg.pathInspectionLot : cfg.pathConfirmation, isQm ? toS4InspectionLot(payload) : toS4Confirmation(payload));
      docNo = r.docNo;
    } else {
      if (!cfg.baseUrl) throw new Error('SAP base URL is not configured');
      const r = await b1Deliver(cfg, isQm, payload);
      docNo = r.docNo;
    }
    await prisma.integrationOutbox.update({
      where: { id },
      data: { status: 'SENT', sapDocNo: docNo, attempts: { increment: 1 }, lastTriedAt: new Date(), lastError: null },
    });
    return { ok: true, docNo };
  } catch (e) {
    const attempts = row.attempts + 1;
    await prisma.integrationOutbox.update({
      where: { id },
      data: {
        status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
        attempts,
        lastTriedAt: new Date(),
        lastError: String(e).slice(0, 1000),
      },
    });
    return { ok: false, error: String(e) };
  }
}

export async function syncPending(limit = 50): Promise<{ sent: number; failed: number }> {
  const rows = await prisma.integrationOutbox.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let sent = 0, failed = 0;
  for (const r of rows) {
    const res = await deliverRow(r.id);
    if (res.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}

// fire-and-forget delivery right after approval when autoSend is on;
// the queue keeps the record either way, so nothing is ever lost.
export async function autoDeliver(outboxId: string) {
  try {
    const cfg = await getSapConfig();
    if (cfg.autoSend) await deliverRow(outboxId);
  } catch {
    // errors are recorded on the row; the worker/manual sync retries
  }
}

// connection test used by the admin screen
export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getSapConfig();
  if (cfg.profile === 'mock') return { ok: true, message: 'Mock profile — no SAP contacted. Deliveries succeed with MOCK-… doc numbers.' };
  if (!cfg.baseUrl) return { ok: false, message: 'Base URL is empty.' };
  try {
    if (cfg.profile === 's4hana') {
      const auth = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
      const res = await fetch(cfg.baseUrl + cfg.pathInspectionLot + '?$top=1' + (cfg.client ? `&sap-client=${cfg.client}` : ''), {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      return res.ok
        ? { ok: true, message: `Connected — ${cfg.pathInspectionLot} reachable (HTTP ${res.status}).` }
        : { ok: false, message: `SAP answered HTTP ${res.status} — check credentials/authorizations/client.` };
    }
    await b1Login(cfg, true);
    // login worked — now check whether the HULAS_QC UDO exists yet
    try {
      await b1Request(cfg, 'GET', cfg.pathInspectionLot + '?$top=1');
      return { ok: true, message: `B1 Service Layer login OK and ${cfg.pathInspectionLot} is reachable.` };
    } catch {
      return {
        ok: false,
        message: `B1 login OK, but ${cfg.pathInspectionLot} is not available — run \`npm run b1:provision\` once to create the HULAS_QC UDT/UDO, or fix the endpoint path.`,
      };
    }
  } catch (e) {
    return { ok: false, message: `Cannot reach SAP: ${String(e).slice(0, 300)} — VPN/network?` };
  }
}
