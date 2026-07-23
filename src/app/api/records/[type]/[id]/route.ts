// Central record API. PATCH = save form snapshot (autosave), POST = workflow
// action { action: submit | approve | reject | unlock, reason? }.
// Server re-evaluates every spec (client colors are advisory only).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { logAudit, logFieldChanges } from '@/lib/audit';
import { evaluate, sampleAverage, suggestOverall } from '@/lib/spec';
import { canApprove, canUnlock } from '@/lib/constants';
import { durationMinutes } from '@/lib/calc';
import { exportToOutbox } from '@/lib/sap';

type Params = { params: { type: string; id: string } };

const EDITABLE = ['DRAFT', 'SUBMITTED', 'REJECTED'];

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json();
  const { type, id } = params;

  try {
    if (type === 'intake') return await saveIntake(id, body, user);
    if (type === 'qc') return await saveQc(id, body, user);
    if (type === 'production') return await saveProduction(id, body, user);
    return NextResponse.json({ error: 'Unknown record type' }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { action, reason } = await req.json();
  const { type, id } = params;
  const recordType = type.toUpperCase();

  const model =
    type === 'intake' ? prisma.intakeReport : type === 'qc' ? prisma.qcReport : type === 'production' ? prisma.productionReport : null;
  if (!model) return NextResponse.json({ error: 'Unknown record type' }, { status: 404 });
  // @ts-expect-error dynamic model union
  const rec = await model.findUnique({ where: { id } });
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (action === 'submit') {
    if (!EDITABLE.includes(rec.status)) return NextResponse.json({ error: 'Record is not editable' }, { status: 400 });
    const missing = await validateForSubmit(type, id);
    if (missing.length) return NextResponse.json({ error: 'missing', missing }, { status: 422 });
    // @ts-expect-error dynamic model union
    await model.update({ where: { id }, data: { status: 'SUBMITTED' } });
    await logAudit(user, recordType, id, 'SUBMIT');
    return NextResponse.json({ ok: true, status: 'SUBMITTED' });
  }

  if (action === 'approve' || action === 'reject') {
    if (!canApprove(user.role)) return NextResponse.json({ error: 'Only a Manager can approve or reject' }, { status: 403 });
    if (rec.status !== 'SUBMITTED') return NextResponse.json({ error: 'Only submitted records can be approved/rejected' }, { status: 400 });
    if (action === 'reject' && !reason?.trim()) return NextResponse.json({ error: 'A rejection reason is required' }, { status: 422 });
    // @ts-expect-error dynamic model union
    await model.update({
      where: { id },
      data:
        action === 'approve'
          ? { status: 'APPROVED', approvedBy: user.name, approvedAt: new Date() }
          : { status: 'REJECTED' },
    });
    await logAudit(user, recordType, id, action.toUpperCase(), undefined, rec.status, action === 'approve' ? 'APPROVED' : `REJECTED: ${reason ?? ''}`);
    if (action === 'approve') {
      // every approval lands in the integration outbox, SAP-shaped
      await exportToOutbox(type === 'intake' ? 'INTAKE' : type === 'qc' ? 'QC' : 'PRODUCTION', id);
    }
    return NextResponse.json({ ok: true, status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
  }

  if (action === 'unlock') {
    if (!canUnlock(user.role)) return NextResponse.json({ error: 'Only a Manager or Admin can unlock' }, { status: 403 });
    if (rec.status !== 'APPROVED') return NextResponse.json({ error: 'Only approved records can be unlocked' }, { status: 400 });
    // @ts-expect-error dynamic model union
    await model.update({ where: { id }, data: { status: 'SUBMITTED', approvedBy: null, approvedAt: null } });
    await logAudit(user, recordType, id, 'UNLOCK', undefined, 'APPROVED', `SUBMITTED (unlock reason: ${reason ?? 'not given'})`);
    return NextResponse.json({ ok: true, status: 'SUBMITTED' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// ---------- validation at submit (drafts may stay half-filled) ----------

async function validateForSubmit(type: string, id: string): Promise<string[]> {
  const missing: string[] = [];
  if (type === 'intake') {
    const r = await prisma.intakeReport.findUniqueOrThrow({ where: { id }, include: { results: true } });
    if (!r.supplierId) missing.push('Supplier / Party name');
    if (!r.weightKg) missing.push('Weight (kg)');
    if (!r.decision) missing.push('Decision (Accepted / Accepted with deduction / Rejected)');
    if ((r.decision === 'REJECTED' || r.decision === 'ACCEPTED_DEDUCTION') && !r.decisionReason?.trim())
      missing.push('Reason for the decision');
    if (r.decision === 'ACCEPTED_DEDUCTION'
        && r.weightCutKg == null && r.priceCutPerQuintal == null && r.deductionAmount == null && r.deductionRate == null)
      missing.push('At least one deduction (weight cut, price cut or flat amount)');
    if (r.decision === 'ACCEPTED_DEDUCTION' && r.pricePerQuintal == null)
      missing.push('Purchase price (₨/quintal) — needed to compute the payable amount');
    if (!r.results.some((x) => x.valueNum !== null || x.valueText)) missing.push('At least one test result');
  }
  if (type === 'qc') {
    const r = await prisma.qcReport.findUniqueOrThrow({ where: { id }, include: { results: true } });
    if (!r.results.some((x) => x.resultNum !== null || x.resultText)) missing.push('At least one test result');
    if (!r.overallResult) missing.push('Overall Result (PASS / FAIL)');
    if (r.overallOverridden && !r.overrideReason?.trim()) missing.push('Reason for overriding the suggested result');
  }
  if (type === 'production') {
    const r = await prisma.productionReport.findUniqueOrThrow({ where: { id }, include: { inputs: true, rows: true } });
    if (!r.inputs.some((i) => (i.netKg ?? 0) > 0)) missing.push('At least one raw material input with a net weight');
    if (!r.rows.length) missing.push('At least one production row');
    if (!r.startTime || !r.closeTime) missing.push('Shift starting and closing time');
  }
  return missing;
}

// ---------- save handlers ----------

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function assertEditable(status: string) {
  if (!EDITABLE.includes(status)) throw new Error('Record is approved and read-only. A Manager must unlock it first.');
}

async function saveIntake(id: string, body: any, user: any) {
  const before = await prisma.intakeReport.findUniqueOrThrow({ where: { id } });
  await assertEditable(before.status);
  const h = body.header ?? {};
  const data = {
    dateAd: h.dateAd ? new Date(h.dateAd + 'T00:00:00') : undefined,
    dateBs: str(h.dateBs) ?? undefined,
    millId: h.millId === undefined ? undefined : h.millId || null,
    batchId: h.batchId === undefined ? undefined : h.batchId || null,
    supplierId: h.supplierId === undefined ? undefined : h.supplierId || null,
    variety: str(h.variety),
    challanNo: str(h.challanNo),
    vehicleNo: str(h.vehicleNo),
    unloadingPlace: str(h.unloadingPlace),
    weightKg: num(h.weightKg),
    bags: num(h.bags),
    bagType: str(h.bagType),
    season: str(h.season),
    decision: str(h.decision),
    decisionReason: str(h.decisionReason),
    pricePerQuintal: num(h.pricePerQuintal),
    weightCutKg: num(h.weightCutKg),
    priceCutPerQuintal: num(h.priceCutPerQuintal),
    deductionAmount: num(h.deductionAmount),
    deductionRate: num(h.deductionRate),
    godownKeeper: str(h.godownKeeper),
    checkedBy: str(h.checkedBy),
  };
  const after = await prisma.intakeReport.update({ where: { id }, data });
  if (before.status !== 'DRAFT') await logFieldChanges(user, 'INTAKE', id, before as any, after as any);

  for (const r of body.results ?? []) {
    const existing = await prisma.intakeResult.findUnique({
      where: { reportId_parameterId: { reportId: id, parameterId: r.parameterId } },
      include: { specVersion: true, parameter: true },
    });
    if (!existing) continue;
    const valueNum = num(r.valueNum);
    const valueText = str(r.valueText);
    await prisma.intakeResult.update({
      where: { id: existing.id },
      data: {
        valueNum,
        valueText,
        note: str(r.note),
        evalStatus: evaluate(existing.specVersion, existing.parameter.valueType, valueNum, valueText),
      },
    });
  }
  return NextResponse.json({ ok: true });
}

async function saveQc(id: string, body: any, user: any) {
  const before = await prisma.qcReport.findUniqueOrThrow({ where: { id } });
  await assertEditable(before.status);
  const h = body.header ?? {};

  const statuses: (string | null)[] = [];
  for (const r of body.results ?? []) {
    const existing = await prisma.qcResult.findUnique({
      where: { reportId_parameterId: { reportId: id, parameterId: r.parameterId } },
      include: { specVersion: true, parameter: true },
    });
    if (!existing) continue;
    const s1 = num(r.sample1), s2 = num(r.sample2), s3 = num(r.sample3);
    const overridden = Boolean(r.resultOverridden);
    const avg = sampleAverage([s1, s2, s3]);
    // auto-average from samples unless the analyst overrode the result
    const resultNum = overridden ? num(r.resultNum) : avg !== null ? avg : num(r.resultNum);
    const resultText = str(r.resultText);
    const evalStatus = evaluate(existing.specVersion, existing.parameter.valueType, resultNum, resultText);
    statuses.push(evalStatus);
    await prisma.qcResult.update({
      where: { id: existing.id },
      data: {
        sample1: s1, sample2: s2, sample3: s3,
        irMoisture: num(r.irMoisture),
        resultNum, resultText,
        resultOverridden: overridden,
        remarks: str(r.remarks),
        evalStatus,
      },
    });
  }

  const suggested = suggestOverall(statuses as any);
  const overallOverridden = Boolean(h.overallOverridden);
  const after = await prisma.qcReport.update({
    where: { id },
    data: {
      dateAd: h.dateAd ? new Date(h.dateAd + 'T00:00:00') : undefined,
      dateBs: str(h.dateBs) ?? undefined,
      analyst: str(h.analyst),
      overallResult: overallOverridden ? str(h.overallResult) : suggested,
      overallOverridden,
      overrideReason: str(h.overrideReason),
      remarks: str(h.remarks),
      premixBrand: str(h.premixBrand),
      premixLot: str(h.premixLot),
      premixTarget: num(h.premixTarget),
      premixActual: num(h.premixActual),
      doserWorking: h.doserWorking === true ? true : h.doserWorking === false ? false : null,
      premixRemarks: str(h.premixRemarks),
      checkedBy: str(h.checkedBy),
    },
  });
  if (before.status !== 'DRAFT') await logFieldChanges(user, 'QC', id, before as any, after as any);
  return NextResponse.json({ ok: true, suggestedOverall: suggested });
}

async function saveProduction(id: string, body: any, user: any) {
  const before = await prisma.productionReport.findUniqueOrThrow({ where: { id } });
  await assertEditable(before.status);
  const h = body.header ?? {};

  // downtime rows drive the auto breakdown total (header value may override)
  await prisma.downtimeEntry.deleteMany({ where: { reportId: id } });
  let autoBreakdown = 0;
  let dSort = 1;
  for (const d of body.downtime ?? []) {
    const dur = num(d.durationMin) ?? durationMinutes(str(d.fromTime), str(d.toTime));
    if (dur) autoBreakdown += dur;
    await prisma.downtimeEntry.create({
      data: {
        reportId: id,
        fromTime: str(d.fromTime), toTime: str(d.toTime),
        durationMin: dur,
        department: str(d.department), rootCause: str(d.rootCause),
        sortOrder: dSort++,
      },
    });
  }

  await prisma.productionInput.deleteMany({ where: { reportId: id } });
  let iSort = 1;
  for (const i of body.inputs ?? []) {
    const kanta = num(i.kantaKg), bora = num(i.boraKg);
    await prisma.productionInput.create({
      data: {
        reportId: id,
        invoiceNo: str(i.invoiceNo),
        kantaKg: kanta, boraKg: bora,
        netKg: kanta !== null ? kanta - (bora ?? 0) : null,
        bagType: str(i.bagType),
        intakeReportId: i.intakeReportId || null,
        sortOrder: iSort++,
      },
    });
  }

  for (const row of body.rows ?? []) {
    const existing = await prisma.productionRow.findFirst({ where: { reportId: id, productId: row.productId } });
    const packed = row.packedKg && typeof row.packedKg === 'object' ? JSON.stringify(row.packedKg) : null;
    if (existing) {
      await prisma.productionRow.update({
        where: { id: existing.id },
        data: { semiFinishedKg: num(row.semiFinishedKg), packedKg: packed },
      });
    }
  }

  const after = await prisma.productionReport.update({
    where: { id },
    data: {
      dateAd: h.dateAd ? new Date(h.dateAd + 'T00:00:00') : undefined,
      dateBs: str(h.dateBs) ?? undefined,
      packagingHours: num(h.packagingHours),
      vendors: str(h.vendors),
      manpower: num(h.manpower),
      startTime: str(h.startTime), closeTime: str(h.closeTime),
      breakdownMin: h.breakdownOverridden ? num(h.breakdownMin) : autoBreakdown || num(h.breakdownMin),
      cumulativeMT: num(h.cumulativeMT),
      electricityKwh: num(h.electricityKwh),
      voltage: num(h.voltage),
      cumulativeKwh: num(h.cumulativeKwh),
      processExtras: h.processExtras ? JSON.stringify(h.processExtras) : null,
      preparedBy: str(h.preparedBy),
    },
  });
  if (before.status !== 'DRAFT') await logFieldChanges(user, 'PRODUCTION', id, before as any, after as any);
  return NextResponse.json({ ok: true });
}
