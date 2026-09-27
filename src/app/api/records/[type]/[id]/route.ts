// Central record API. PATCH = save form snapshot (autosave), POST = workflow
// action { action: submit | approve | reject | unlock | sign | unsign | delete, reason?, slot? }.
// Server re-evaluates every spec (client colors are advisory only).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { logAudit, logFieldChanges } from '@/lib/audit';
import { evaluate, sampleAverage, suggestOverall } from '@/lib/spec';
import { durationMinutes, netInputKg, unitsToKg, parseVendors, VENDOR_SEP } from '@/lib/calc';
import { signRecord, unsignRecord, defaultSlot, type RecordKind } from '@/lib/sign';
import { EDITABLE, WorkflowError, approveRecord, rejectRecord, submitRecord, unlockRecord, loadRecord } from '@/lib/workflow';
import { canSetDecision } from '@/lib/approval';

type Params = { params: { type: string; id: string } };

const KINDS: RecordKind[] = ['intake', 'qc', 'production'];

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
    if (e instanceof WorkflowError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { action, reason, slot } = await req.json();
  const kind = params.type as RecordKind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown record type' }, { status: 404 });
  const id = params.id;
  const recordType = kind.toUpperCase();

  try {
    const rec = await loadRecord(kind, id);

    if (action === 'submit') return NextResponse.json({ ok: true, ...(await submitRecord(user, kind, id)) });
    if (action === 'approve') return NextResponse.json({ ok: true, ...(await approveRecord(user, kind, id)) });
    if (action === 'reject') return NextResponse.json({ ok: true, ...(await rejectRecord(user, kind, id, reason)) });
    if (action === 'unlock') return NextResponse.json({ ok: true, ...(await unlockRecord(user, kind, id, reason)) });

    if (action === 'sign') {
      // manual co-sign (e.g. the godown keeper on an intake report). signRecord
      // enforces the slot's role and refuses approval slots.
      if (!EDITABLE.includes(rec.status)) return NextResponse.json({ error: 'Approved records cannot be signed — they are already sealed' }, { status: 400 });
      const target = slot || (await defaultSlot(kind, user.role));
      if (!target) return NextResponse.json({ error: 'No signature slot on this report belongs to your role' }, { status: 403 });
      await signRecord(user, kind, id, target);
      return NextResponse.json({ ok: true });
    }

    if (action === 'unsign') {
      // take a signature back while the record is still editable (own slot, or any slot for Manager/Admin)
      if (!EDITABLE.includes(rec.status)) return NextResponse.json({ error: 'Approved records are sealed — a Manager must unlock first' }, { status: 400 });
      if (!slot) return NextResponse.json({ error: 'slot is required' }, { status: 400 });
      await unsignRecord(user, kind, id, slot);
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete') {
      // drafts only — anything ever submitted stays forever (audit trail)
      if (rec.status !== 'DRAFT') {
        return NextResponse.json({ error: 'Only drafts can be deleted. Submitted and approved records are part of the audit trail.' }, { status: 400 });
      }
      await logAudit(user, recordType, id, 'DELETE', undefined, 'DRAFT', `draft ${rec.reportNo} deleted`);
      await prisma.signature.deleteMany({ where: { recordType, recordId: id } });
      await prisma.notification.updateMany({ where: { recordId: id, status: { in: ['PENDING', 'SKIPPED'] } }, data: { status: 'SKIPPED', lastError: 'record deleted' } });
      await prisma.integrationOutbox.deleteMany({ where: { recordId: id } });
      const model = kind === 'intake' ? prisma.intakeReport : kind === 'qc' ? prisma.qcReport : prisma.productionReport;
      // @ts-expect-error dynamic model union
      await model.delete({ where: { id } }); // results/rows cascade
      return NextResponse.json({ ok: true, deleted: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    if (e instanceof WorkflowError) {
      return NextResponse.json(e.missing ? { error: e.message, missing: e.missing } : { error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 400 });
  }
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
  // Decision + deductions belong to the approver. Other users' forms don't send
  // them (so they are left as stored); sending a change anyway is refused.
  const DECISION_FIELDS = { decision: str, decisionReason: str, weightCutKg: num, priceCutPerQuintal: num, deductionAmount: num } as const;
  const mayDecide = await canSetDecision('intake', before, user.role);
  const decisionData: Record<string, unknown> = {};
  for (const [key, parse] of Object.entries(DECISION_FIELDS)) {
    if (!(key in h)) continue;
    const incoming = (parse as (v: unknown) => unknown)(h[key]);
    if (mayDecide) decisionData[key] = incoming;
    else if (incoming !== (before as any)[key]) {
      throw new WorkflowError('Only the approver of the step this report is waiting on can set the Decision and deductions.', 403);
    }
  }
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
    ...decisionData,
    pricePerQuintal: num(h.pricePerQuintal),
    deductionRate: num(h.deductionRate),
    // godownKeeper / checkedBy are set by the digital sign-off flow, not the form
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
  // overriding the computed PASS/FAIL is the current approver's call (approval
  // matrix) — the form hides the switch from others, and the API refuses it too
  if (!(await canSetDecision('qc', before, user.role))) {
    const changed = overallOverridden !== before.overallOverridden
      || (overallOverridden && str(h.overallResult) !== before.overallResult);
    if (changed) throw new WorkflowError('Only the approver of the step this sheet is waiting on can override the overall PASS/FAIL result.', 403);
  }
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
      // checkedBy is set by the digital sign-off flow, not the form
    },
  });
  if (before.status !== 'DRAFT') await logFieldChanges(user, 'QC', id, before as any, after as any);
  return NextResponse.json({ ok: true, suggestedOverall: suggested });
}

async function saveProduction(id: string, body: any, user: any) {
  const before = await prisma.productionReport.findUniqueOrThrow({ where: { id } });
  await assertEditable(before.status);
  const h = body.header ?? {};

  // Vendor(s): names from the supplier master only. Hand-typed text saved before
  // this became a list may stay until someone removes it, but nothing new.
  let vendors: string | null | undefined = undefined; // undefined = leave as stored
  if (Array.isArray(h.vendorList)) {
    const list = [...new Set((h.vendorList as unknown[]).map((v) => String(v).trim()).filter(Boolean))];
    const known = new Set((await prisma.supplier.findMany({ where: { name: { in: list } }, select: { name: true } })).map((x) => x.name));
    const legacy = new Set(parseVendors(before.vendors));
    const unknown = list.filter((v) => !known.has(v) && !legacy.has(v));
    if (unknown.length) throw new WorkflowError(`Vendor(s) must be chosen from the supplier list — not found: ${unknown.join(', ')}`, 422);
    vendors = list.length ? list.join(VENDOR_SEP) : null;
  }

  // downtime rows drive the auto breakdown total (header value may override)
  await prisma.downtimeEntry.deleteMany({ where: { reportId: id } });
  let autoBreakdown = 0;
  let dSort = 1;
  for (const d of body.downtime ?? []) {
    const dur = durationMinutes(str(d.fromTime), str(d.toTime));
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
        netKg: netInputKg(kanta, bora),
        bagType: str(i.bagType),
        intakeReportId: i.intakeReportId || null,
        sortOrder: iSort++,
      },
    });
  }

  // pack columns arrive as bag/packet counts; kg is derived from the pack size master
  const packs = await prisma.packSize.findMany({ select: { id: true, grams: true } });
  for (const row of body.rows ?? []) {
    const existing = await prisma.productionRow.findFirst({ where: { reportId: id, productId: row.productId } });
    if (!existing) continue;
    const units: Record<string, number> = {};
    if (row.packedUnits && typeof row.packedUnits === 'object') {
      for (const [pid, v] of Object.entries(row.packedUnits)) {
        const n = num(v);
        if (n !== null && n > 0) units[pid] = n;
      }
    }
    await prisma.productionRow.update({
      where: { id: existing.id },
      data: {
        semiFinishedKg: num(row.semiFinishedKg),
        packedUnits: JSON.stringify(units),
        packedKg: JSON.stringify(unitsToKg(units, packs)),
      },
    });
  }

  const after = await prisma.productionReport.update({
    where: { id },
    data: {
      dateAd: h.dateAd ? new Date(h.dateAd + 'T00:00:00') : undefined,
      dateBs: str(h.dateBs) ?? undefined,
      packagingHours: num(h.packagingHours),
      vendors,
      manpower: num(h.manpower),
      startTime: str(h.startTime), closeTime: str(h.closeTime),
      // auto = Σ downtime log; a ticked override keeps whatever the supervisor typed
      breakdownMin: h.breakdownOverridden ? num(h.breakdownMin) : autoBreakdown,
      cumulativeMT: num(h.cumulativeMT),
      electricityKwh: num(h.electricityKwh),
      voltage: num(h.voltage),
      cumulativeKwh: num(h.cumulativeKwh),
      processExtras: h.processExtras ? JSON.stringify(h.processExtras) : null,
      // preparedBy is set by the digital sign-off flow, not the form
    },
  });
  if (before.status !== 'DRAFT') await logFieldChanges(user, 'PRODUCTION', id, before as any, after as any);
  return NextResponse.json({ ok: true });
}
