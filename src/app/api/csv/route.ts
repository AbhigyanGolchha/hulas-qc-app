// CSV export of any filtered list (same filters as the list pages).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { adIso, todayKathmandu } from '@/lib/dates';
import { parsePacked, rowTotalKg, shiftMinutes, efficiencyPct } from '@/lib/calc';
import { buildWeekly, resolveWeekStart, weeklyCsvRows } from '@/lib/weekly';

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c === null || c === undefined ? '' : String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const type = p.get('type');
  const from = p.get('from'), to = p.get('to');
  const dateFilter = from || to ? { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + 'T23:59:59') } : {}) } : undefined;

  let body = '';
  let name = 'export';

  if (type === 'intake') {
    const where: any = {};
    if (p.get('material')) where.materialId = p.get('material');
    if (p.get('status')) where.status = p.get('status');
    if (p.get('supplier')) where.supplierId = p.get('supplier');
    if (dateFilter) where.dateAd = dateFilter;
    const rows = await prisma.intakeReport.findMany({ where, include: { material: true, supplier: true, mill: true, results: { include: { parameter: true } } }, orderBy: { dateAd: 'desc' } });
    const paramNames = [...new Set(rows.flatMap((r) => r.results.map((x) => x.parameter.name)))];
    body = csv([
      ['Report No', 'Date AD', 'Miti BS', 'Material', 'Variety', 'Supplier', 'Challan', 'Vehicle', 'Weight kg', 'Bags', 'Bag type', 'Season', 'Destination mill', 'Decision', 'Reason', 'Deduction', 'Status', ...paramNames],
      ...rows.map((r) => [
        r.reportNo, adIso(r.dateAd), r.dateBs, r.material.name, r.variety, r.supplier?.name, r.challanNo, r.vehicleNo, r.weightKg, r.bags, r.bagType, r.season, r.mill?.name, r.decision, r.decisionReason, r.deductionAmount, r.status,
        ...paramNames.map((n) => {
          const res = r.results.find((x) => x.parameter.name === n);
          return res ? res.valueNum ?? res.valueText ?? '' : '';
        }),
      ]),
    ]);
    name = 'intake';
  } else if (type === 'qc') {
    const where: any = {};
    if (p.get('mill')) where.batch = { millId: p.get('mill') };
    if (p.get('product')) where.productId = p.get('product');
    if (p.get('status')) where.status = p.get('status');
    if (dateFilter) where.dateAd = dateFilter;
    const rows = await prisma.qcReport.findMany({ where, include: { batch: { include: { mill: true } }, product: true, results: { include: { parameter: true } } }, orderBy: { dateAd: 'desc' } });
    const paramNames = [...new Set(rows.flatMap((r) => r.results.map((x) => x.parameter.name)))];
    body = csv([
      ['Report No', 'Date AD', 'Miti BS', 'Mill', 'Batch', 'Product', 'Overall', 'Remarks', 'Analyst', 'Status', ...paramNames],
      ...rows.map((r) => [
        r.reportNo, adIso(r.dateAd), r.dateBs, r.batch.mill.name, r.batch.batchNo, r.product.name, r.overallResult, r.remarks, r.analyst, r.status,
        ...paramNames.map((n) => {
          const res = r.results.find((x) => x.parameter.name === n);
          return res ? res.resultNum ?? res.resultText ?? '' : '';
        }),
      ]),
    ]);
    name = 'qc';
  } else if (type === 'production') {
    const where: any = {};
    if (p.get('mill')) where.millId = p.get('mill');
    if (p.get('status')) where.status = p.get('status');
    if (dateFilter) where.dateAd = dateFilter;
    const rows = await prisma.productionReport.findMany({ where, include: { mill: true, batch: true, inputs: true, rows: { include: { product: true } } }, orderBy: { dateAd: 'desc' } });
    body = csv([
      ['Report No', 'Date AD', 'Miti BS', 'Mill', 'Batch', 'Net input kg', 'Total output kg', 'Main product kg', 'Total recovery %', 'Main yield %', 'Manpower', 'Shift', 'Breakdown min', 'Efficiency %', 'kWh', 'Status'],
      ...rows.map((r) => {
        const net = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
        const out = r.rows.reduce((a, row) => a + rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)), 0);
        const main = r.rows.filter((x) => x.product.kind === 'PRODUCT').reduce((a, x) => a + rowTotalKg(x.semiFinishedKg, parsePacked(x.packedKg)), 0);
        const sm = shiftMinutes(r.startTime, r.closeTime);
        return [
          r.reportNo, adIso(r.dateAd), r.dateBs, r.mill.name, r.batch.batchNo, net, out, main,
          net ? ((out / net) * 100).toFixed(2) : '', net ? ((main / net) * 100).toFixed(2) : '',
          r.manpower, r.startTime && r.closeTime ? `${r.startTime}-${r.closeTime}` : '', r.breakdownMin,
          efficiencyPct(sm, r.breakdownMin ?? 0) ?? '', r.electricityKwh, r.status,
        ];
      }),
    ]);
    name = 'production';
  } else if (type === 'weekly') {
    const start = resolveWeekStart(p.get('start') ?? undefined);
    const w = await buildWeekly(start);
    body = csv(weeklyCsvRows(w));
    name = `weekly-${w.start}`;
  } else {
    return NextResponse.json({ error: 'type must be intake|qc|production|weekly' }, { status: 400 });
  }

  return new NextResponse('﻿' + body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hulas-${name}-${todayKathmandu()}.csv"`,
    },
  });
}
