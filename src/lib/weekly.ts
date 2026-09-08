// Weekly production rollup — Sunday–Saturday (Nepali working week), per mill.
// One data builder shared by the on-screen report, the print/PDF view and
// the CSV export, so all three always show the same numbers.
import { prisma } from './db';
import { adIso, addDays, todayKathmandu } from './dates';
import { parsePacked, rowTotalKg, round2, shiftMinutes, efficiencyPct } from './calc';

export function weekStartOf(adIsoStr: string): string {
  const [y, m, d] = adIsoStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return adIso(new Date(y, m - 1, d - dt.getDay())); // getDay(): 0 = Sunday
}

export function resolveWeekStart(param: string | undefined): string {
  return weekStartOf(param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : todayKathmandu());
}

export type WeeklyDay = {
  id: string;
  reportNo: string;
  dateAd: string;
  dateBs: string;
  batchNo: string;
  status: string;
  inputKg: number;
  outputKg: number;
  mainKg: number;
  recoveryPct: number | null;
  mainYieldPct: number | null;
  shiftMin: number | null;
  breakdownMin: number;
  efficiencyPct: number | null;
  electricityKwh: number | null;
  manpower: number | null;
};

export type WeeklyProduct = { productId: string; name: string; kind: string; kg: number; pctOfInput: number | null };

export type WeeklyMill = {
  millId: string;
  millName: string;
  limits: { totalRecoveryMin: number | null; totalRecoveryMax: number | null; mainYieldMin: number | null; mainYieldMax: number | null };
  days: WeeklyDay[];
  netInput: number;
  totalOutput: number;
  mainOutput: number;
  recoveryPct: number | null;
  mainYieldPct: number | null;
  downtimeMin: number;
  shiftMin: number;
  efficiencyPct: number | null;
  electricityKwh: number;
  products: WeeklyProduct[];
};

export type Weekly = { start: string; end: string; mills: WeeklyMill[] };

export async function buildWeekly(start: string): Promise<Weekly> {
  const end = addDays(start, 6); // inclusive Saturday
  const from = new Date(start + 'T00:00:00');
  const to = new Date(addDays(start, 7) + 'T00:00:00');

  const [mills, reports] = await Promise.all([
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.productionReport.findMany({
      where: { dateAd: { gte: from, lt: to }, status: { in: ['SUBMITTED', 'APPROVED'] } },
      include: { batch: true, inputs: true, rows: { include: { product: true } }, downtime: true },
      orderBy: { dateAd: 'asc' },
    }),
  ]);

  const byMill: WeeklyMill[] = mills.map((mill) => {
    const rs = reports.filter((r) => r.millId === mill.id);
    let netInput = 0, totalOutput = 0, mainOutput = 0, downtimeMin = 0, shiftTotal = 0, electricity = 0;
    const products = new Map<string, WeeklyProduct>();
    const days: WeeklyDay[] = rs.map((r) => {
      const inp = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
      let out = 0, main = 0;
      for (const row of r.rows) {
        const kg = rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg));
        out += kg;
        const p = products.get(row.productId) ?? { productId: row.productId, name: row.product.name, kind: row.product.kind, kg: 0, pctOfInput: null };
        p.kg += kg;
        products.set(row.productId, p);
        if (row.product.kind === 'PRODUCT') main += kg;
      }
      // the report's breakdown figure wins (it may be a supervisor override of the log)
      const bd = r.breakdownMin ?? r.downtime.reduce((a, d) => a + (d.durationMin ?? 0), 0);
      const sm = shiftMinutes(r.startTime, r.closeTime);
      netInput += inp;
      totalOutput += out;
      mainOutput += main;
      downtimeMin += bd;
      shiftTotal += sm ?? 0;
      electricity += r.electricityKwh ?? 0;
      return {
        id: r.id, reportNo: r.reportNo, dateAd: adIso(r.dateAd), dateBs: r.dateBs, batchNo: r.batch.batchNo, status: r.status,
        inputKg: inp, outputKg: out, mainKg: main,
        recoveryPct: inp ? round2((out / inp) * 100) : null,
        mainYieldPct: inp ? round2((main / inp) * 100) : null,
        shiftMin: sm, breakdownMin: bd, efficiencyPct: efficiencyPct(sm, bd),
        electricityKwh: r.electricityKwh, manpower: r.manpower,
      };
    });
    for (const p of products.values()) p.pctOfInput = netInput && p.kg ? round2((p.kg / netInput) * 100) : null;
    return {
      millId: mill.id,
      millName: mill.name,
      limits: { totalRecoveryMin: mill.totalRecoveryMin, totalRecoveryMax: mill.totalRecoveryMax, mainYieldMin: mill.mainYieldMin, mainYieldMax: mill.mainYieldMax },
      days,
      netInput, totalOutput, mainOutput,
      recoveryPct: netInput ? round2((totalOutput / netInput) * 100) : null,
      mainYieldPct: netInput ? round2((mainOutput / netInput) * 100) : null,
      downtimeMin,
      shiftMin: shiftTotal,
      // week efficiency = Σ production time ÷ Σ shift time (weighted, not an average of daily %)
      efficiencyPct: shiftTotal ? round2((Math.max(0, shiftTotal - downtimeMin) / shiftTotal) * 100) : null,
      electricityKwh: electricity,
      products: [...products.values()].sort((a, b) => b.kg - a.kg),
    };
  }).filter((m) => m.days.length > 0);

  return { start, end, mills: byMill };
}

export function weeklyCsvRows(w: Weekly): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  rows.push([`Weekly Production Report ${w.start} to ${w.end} (Sunday–Saturday)`]);
  rows.push([]);
  rows.push(['MILL SUMMARY']);
  rows.push(['Mill', 'Production days', 'Raw material in (kg)', 'Total out (kg)', 'Main products (kg)', 'Total recovery %', 'Main-product yield %', 'Expected recovery band', 'Expected main yield band', 'Shift time (min)', 'Downtime (min)', 'Efficiency %', 'Electricity (kWh)']);
  for (const m of w.mills) {
    rows.push([
      m.millName, m.days.length, m.netInput, m.totalOutput, m.mainOutput, m.recoveryPct, m.mainYieldPct,
      band(m.limits.totalRecoveryMin, m.limits.totalRecoveryMax), band(m.limits.mainYieldMin, m.limits.mainYieldMax),
      m.shiftMin, m.downtimeMin, m.efficiencyPct, m.electricityKwh,
    ]);
  }
  rows.push([]);
  rows.push(['OUTPUT BY PRODUCT']);
  rows.push(['Mill', 'Product', 'Kind', 'kg', '% of input']);
  for (const m of w.mills) for (const p of m.products) rows.push([m.millName, p.name, p.kind === 'BYPRODUCT' ? 'by-product' : 'main product', p.kg, p.pctOfInput]);
  rows.push([]);
  rows.push(['DAY BY DAY']);
  rows.push(['Mill', 'Date AD', 'Miti BS', 'Report No', 'Batch', 'Status', 'In (kg)', 'Out (kg)', 'Main (kg)', 'Recovery %', 'Main yield %', 'Shift (min)', 'Breakdown (min)', 'Efficiency %', 'Manpower', 'kWh']);
  for (const m of w.mills) for (const d of m.days) {
    rows.push([m.millName, d.dateAd, d.dateBs, d.reportNo, d.batchNo, d.status, d.inputKg, d.outputKg, d.mainKg, d.recoveryPct, d.mainYieldPct, d.shiftMin, d.breakdownMin, d.efficiencyPct, d.manpower, d.electricityKwh]);
  }
  return rows;
}

function band(min: number | null, max: number | null): string {
  if (min === null && max === null) return '';
  return `${min ?? ''}–${max ?? ''}%`;
}
