// Workflow actions shared by the record API and the dashboard quick-approve
// button, so both paths do exactly the same thing: status change, signature,
// audit row, SAP outbox on final approval, and the email notification.
import { prisma } from './db';
import type { SessionUser } from './auth';
import { logAudit } from './audit';
import { roleListLabel, roleSet } from './roles';
import { exportToOutbox } from './sap';
import { signRecord, voidSignatures, defaultSlot, type RecordKind } from './sign';
import { getStages, currentStage, roleMayApprove, adminOverride, canUnlockNow, type Stage } from './approval';
import { notifyEvent } from './notify';
import { checkYields, parsePacked, rowTotalKg, lotConsumedKg, fmtKg, countsInOutput } from './calc';

export const EDITABLE = ['DRAFT', 'SUBMITTED', 'REJECTED'];

export class WorkflowError extends Error {
  status: number;
  missing?: string[];
  constructor(message: string, status = 400, missing?: string[]) {
    super(message);
    this.status = status;
    this.missing = missing;
  }
}

export function modelFor(kind: RecordKind) {
  return kind === 'intake' ? prisma.intakeReport : kind === 'qc' ? prisma.qcReport : prisma.productionReport;
}

export async function loadRecord(kind: RecordKind, id: string) {
  // @ts-expect-error dynamic model union
  const rec = await modelFor(kind).findUnique({ where: { id } });
  if (!rec) throw new WorkflowError('Not found', 404);
  return rec as { id: string; status: string; approvalStage: number; reportNo: string; createdById: string | null };
}

// ---------- submit ----------

export async function submitRecord(user: SessionUser, kind: RecordKind, id: string) {
  const rec = await loadRecord(kind, id);
  if (!EDITABLE.includes(rec.status)) throw new WorkflowError('Record is not editable');
  const missing = await validateForSubmit(kind, id);
  if (missing.length) throw new WorkflowError('missing', 422, missing);
  const stages = await getStages(kind);
  if (!stages.length) throw new WorkflowError('No approval steps are set up for this report type yet — an Admin adds them in Admin → Approval matrix.', 409);
  // @ts-expect-error dynamic model union
  await modelFor(kind).update({ where: { id }, data: { status: 'SUBMITTED', approvalStage: 0 } });
  // submitting IS signing: the submitter's e-signature lands in the slot bound
  // to their role (none if no slot is theirs — they never sign someone else's)
  // — but never over someone who already signed it (several roles may share a slot)
  const ownSlot = await defaultSlot(kind, user.role);
  const taken = ownSlot && (await prisma.signature.findUnique({ where: { recordType_recordId_slot: { recordType: kind.toUpperCase(), recordId: id, slot: ownSlot } } }));
  if (ownSlot && !taken) await signRecord(user, kind, id, ownSlot);
  await logAudit(user, kind.toUpperCase(), id, 'SUBMIT');

  // tell the first approver, plus any module-specific alarms
  await notifyEvent({ event: 'SUBMITTED', kind, recordId: id, actor: user, roles: roleSet(stages[0].role) });
  await moduleAlarms(user, kind, id);
  return { status: 'SUBMITTED' };
}

async function moduleAlarms(user: SessionUser, kind: RecordKind, id: string) {
  if (kind === 'qc') {
    const r = await prisma.qcReport.findUniqueOrThrow({ where: { id } });
    if (r.overallResult === 'FAIL') await notifyEvent({ event: 'QC_FAILED', kind, recordId: id, actor: user });
  }
  if (kind === 'production') {
    const r = await prisma.productionReport.findUniqueOrThrow({ where: { id }, include: { mill: true, inputs: true, rows: { include: { product: true } } } });
    const net = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
    const total = r.rows.filter((x) => countsInOutput(x.product.kind)).reduce((a, row) => a + rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)), 0);
    const main = r.rows.filter((x) => x.product.kind === 'PRODUCT').reduce((a, x) => a + rowTotalKg(x.semiFinishedKg, parsePacked(x.packedKg)), 0);
    const y = checkYields(net, total, main, r.mill);
    if (y.warnings.length) await notifyEvent({ event: 'YIELD_WARNING', kind, recordId: id, actor: user, extraLines: y.warnings });
  }
}

// ---------- approve / reject ----------

// the step's role from the approval matrix (or an Admin, if step-in is switched on)
async function assertMayApprove(user: SessionUser, stage: Stage | null) {
  if (!stage) throw new WorkflowError('No approval steps are set up for this report type — Admin → Approval matrix.', 409);
  if (!roleMayApprove(stage, user.role, await adminOverride())) {
    throw new WorkflowError(`This step ("${stage.title}") is approved by: ${await roleListLabel(stage.role)}.`, 403);
  }
}

export async function approveRecord(user: SessionUser, kind: RecordKind, id: string) {
  const rec = await loadRecord(kind, id);
  if (rec.status !== 'SUBMITTED') throw new WorkflowError('Only submitted records can be approved/rejected');
  const stages = await getStages(kind);
  const stage = currentStage(stages, rec.approvalStage ?? 0);
  await assertMayApprove(user, stage);
  if (kind === 'production') {
    const over = await lotOverAllocations(id);
    if (over.length) throw new WorkflowError(`Before approving: ${over.join('; ')}.`, 422);
  }
  if (kind === 'intake') {
    // the lot decision is made at approval — it must be set before anyone approves
    const r = await prisma.intakeReport.findUniqueOrThrow({ where: { id } });
    const problems = intakeDecisionProblems(r, true);
    if (problems.length) throw new WorkflowError(`Before approving: ${problems.join('; ')}.`, 422);
  }
  // sign this stage's slot, then either advance or finish
  await signRecord(user, kind, id, stage!.title, { viaApproval: true });
  const nextIdx = (rec.approvalStage ?? 0) + 1;
  const isFinal = nextIdx >= stages.length;
  // @ts-expect-error dynamic model union
  await modelFor(kind).update({
    where: { id },
    data: isFinal
      ? { status: 'APPROVED', approvalStage: nextIdx, approvedBy: user.name, approvedAt: new Date() }
      : { approvalStage: nextIdx },
  });
  await logAudit(user, kind.toUpperCase(), id, 'APPROVE', undefined, rec.status,
    isFinal ? 'APPROVED' : `stage ${nextIdx}/${stages.length} ("${stage?.title}") approved — waiting on "${stages[nextIdx]?.title}"`);
  if (isFinal) {
    // only the FINAL approval lands in the integration outbox, SAP-shaped
    await exportToOutbox(kind === 'intake' ? 'INTAKE' : kind === 'qc' ? 'QC' : 'PRODUCTION', id);
    await notifyEvent({ event: 'APPROVED', kind, recordId: id, actor: user });
    if (kind === 'intake') {
      // the decision is final now — raise the alarm for rejected / deducted lots
      const r = await prisma.intakeReport.findUniqueOrThrow({ where: { id } });
      if (r.decision === 'REJECTED' || r.decision === 'ACCEPTED_DEDUCTION') {
        await notifyEvent({ event: 'INTAKE_REJECTED', kind, recordId: id, actor: user, extraLines: [r.decision === 'REJECTED' ? 'REJECTED' : 'accepted with deduction'] });
      }
    }
  } else {
    await notifyEvent({ event: 'STAGE_APPROVED', kind, recordId: id, actor: user, roles: roleSet(stages[nextIdx].role), extraLines: [`Next step: "${stages[nextIdx].title}" (${await roleListLabel(stages[nextIdx].role)})`] });
  }
  return { status: isFinal ? 'APPROVED' : 'SUBMITTED', stage: nextIdx, of: stages.length };
}

export async function rejectRecord(user: SessionUser, kind: RecordKind, id: string, reason: string | undefined) {
  const rec = await loadRecord(kind, id);
  if (rec.status !== 'SUBMITTED') throw new WorkflowError('Only submitted records can be approved/rejected');
  const stages = await getStages(kind);
  const stage = currentStage(stages, rec.approvalStage ?? 0);
  await assertMayApprove(user, stage);
  if (!reason?.trim()) throw new WorkflowError('A rejection reason is required', 422);
  // @ts-expect-error dynamic model union
  await modelFor(kind).update({ where: { id }, data: { status: 'REJECTED', approvalStage: 0 } });
  // approver signatures no longer attest to anything — preparer slots stay
  await prisma.signature.deleteMany({ where: { recordType: kind.toUpperCase(), recordId: id, slot: { in: stages.map((s) => s.title) } } });
  await logAudit(user, kind.toUpperCase(), id, 'REJECT', undefined, rec.status, `REJECTED at "${stage?.title ?? 'approval'}": ${reason}`);
  await notifyEvent({ event: 'REJECTED', kind, recordId: id, actor: user, reason });
  return { status: 'REJECTED' };
}

// ---------- unlock ----------

export async function unlockRecord(user: SessionUser, kind: RecordKind, id: string, reason: string | undefined) {
  const rec = await loadRecord(kind, id);
  if (!(await canUnlockNow(kind, user.role))) throw new WorkflowError('Your role is not allowed to unlock these reports (Admin → Approval matrix).', 403);
  if (rec.status !== 'APPROVED') throw new WorkflowError('Only approved records can be unlocked');
  // the notification needs the signer list BEFORE it is voided
  await notifyEvent({ event: 'UNLOCKED', kind, recordId: id, actor: user, reason });
  // @ts-expect-error dynamic model union
  await modelFor(kind).update({ where: { id }, data: { status: 'SUBMITTED', approvalStage: 0, approvedBy: null, approvedAt: null } });
  // an unlocked record can change — its signatures no longer attest to anything
  await voidSignatures(user, kind, id);
  await logAudit(user, kind.toUpperCase(), id, 'UNLOCK', undefined, 'APPROVED', `SUBMITTED (unlock reason: ${reason ?? 'not given'})`);
  return { status: 'SUBMITTED' };
}

// ---------- validation at submit (drafts may stay half-filled) ----------

export async function validateForSubmit(kind: RecordKind, id: string): Promise<string[]> {
  const missing: string[] = [];
  if (kind === 'intake') {
    const r = await prisma.intakeReport.findUniqueOrThrow({ where: { id }, include: { results: true } });
    if (!r.supplierId) missing.push('Supplier / Party name');
    if (!r.weightKg) missing.push('Weight (kg)');
    // the Decision itself is set by the approver, so submit doesn't need it —
    // but if one is already there (Manager-prepared report) it must be complete
    missing.push(...intakeDecisionProblems(r, false));
    if (!r.results.some((x) => x.valueNum !== null || x.valueText)) missing.push('At least one test result');
  }
  if (kind === 'qc') {
    const r = await prisma.qcReport.findUniqueOrThrow({ where: { id }, include: { results: true } });
    if (!r.results.some((x) => x.resultNum !== null || x.resultText)) missing.push('At least one test result');
    if (!r.overallResult) missing.push('Overall Result (PASS / FAIL)');
    if (r.overallOverridden && !r.overrideReason?.trim()) missing.push('Reason for overriding the suggested result');
  }
  if (kind === 'production') {
    const r = await prisma.productionReport.findUniqueOrThrow({ where: { id }, include: { inputs: true, rows: { include: { product: true } }, downtime: true } });
    if (!r.inputs.some((i) => (i.netKg ?? 0) > 0)) missing.push('At least one raw material input with a net weight');
    if (r.inputs.some((i) => i.kantaKg != null && i.boraKg != null && i.boraKg > i.kantaKg))
      missing.push('A raw material line has bora (tare) weight heavier than kanta (gross) weight — check the weights');
    if (!r.rows.length) missing.push('At least one production row');
    if (!r.rows.some((row) => countsInOutput(row.product.kind) && rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)) > 0)) missing.push('At least one product with output (semi-finished or packed)');
    if (!r.startTime || !r.closeTime) missing.push('Shift starting and closing time');
    if (r.downtime.some((d) => (d.fromTime && !d.toTime) || (!d.fromTime && d.toTime))) missing.push('Every downtime entry needs both From and To times');
    missing.push(...(await lotOverAllocations(id)));
  }
  return missing;
}

// Intake lots this production report links to that are over-used: every
// report's linked kanta weight together may not exceed the lot's weight.
// Checked at submit and again at approval, so two reports filled in at the
// same time can't both take the same kilos.
export async function lotOverAllocations(reportId: string): Promise<string[]> {
  const inputs = await prisma.productionInput.findMany({ where: { reportId, intakeReportId: { not: null } }, select: { intakeReportId: true } });
  const lotIds = [...new Set(inputs.map((i) => i.intakeReportId!))];
  if (!lotIds.length) return [];
  const lots = await prisma.intakeReport.findMany({
    where: { id: { in: lotIds } },
    include: { productionInputs: { select: { kantaKg: true, netKg: true } } },
  });
  const out: string[] = [];
  for (const lot of lots) {
    if (lot.weightKg == null) continue;
    const used = lot.productionInputs.reduce((a, x) => a + lotConsumedKg(x), 0);
    if (used > lot.weightKg + 0.5) {
      out.push(`Intake lot ${lot.reportNo} is ${fmtKg(lot.weightKg)} kg but production reports have linked ${fmtKg(used)} kg to it — only what is left can be linked`);
    }
  }
  return out;
}

// Decision completeness for an intake report. requireDecision = at approval,
// where a decision must exist; at submit only a present decision is checked.
type IntakeDecisionFields = {
  decision: string | null; decisionReason: string | null; weightKg: number | null; pricePerQuintal: number | null;
  weightCutKg: number | null; priceCutPerQuintal: number | null; deductionAmount: number | null; deductionRate: number | null;
};
export function intakeDecisionProblems(r: IntakeDecisionFields, requireDecision: boolean): string[] {
  const out: string[] = [];
  if (!r.decision) {
    if (requireDecision) out.push('set the Decision (Accepted / Accepted with deduction / Rejected)');
    return out;
  }
  if ((r.decision === 'REJECTED' || r.decision === 'ACCEPTED_DEDUCTION') && !r.decisionReason?.trim())
    out.push('Reason for the decision');
  if (r.decision === 'ACCEPTED_DEDUCTION'
      && r.weightCutKg == null && r.priceCutPerQuintal == null && r.deductionAmount == null && r.deductionRate == null)
    out.push('At least one deduction (weight cut, price cut or flat amount)');
  if (r.decision === 'ACCEPTED_DEDUCTION' && r.pricePerQuintal == null)
    out.push('Purchase price (₨/quintal) — needed to compute the payable amount');
  if (r.weightCutKg != null && r.weightKg != null && r.weightCutKg > r.weightKg)
    out.push('Weight cut cannot be more than the lot weight');
  return out;
}
