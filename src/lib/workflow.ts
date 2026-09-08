// Workflow actions shared by the record API and the dashboard quick-approve
// button, so both paths do exactly the same thing: status change, signature,
// audit row, SAP outbox on final approval, and the email notification.
import { prisma } from './db';
import type { SessionUser } from './auth';
import { logAudit } from './audit';
import { canApprove, canUnlock } from './constants';
import { exportToOutbox } from './sap';
import { signRecord, voidSignatures, defaultSlot, SLOTS, type RecordKind } from './sign';
import { getStages, currentStage, roleMayApprove } from './approval';
import { notifyEvent } from './notify';
import { checkYields, parsePacked, rowTotalKg } from './calc';

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
  // @ts-expect-error dynamic model union
  await modelFor(kind).update({ where: { id }, data: { status: 'SUBMITTED', approvalStage: 0 } });
  // submitting IS signing: the submitter's e-signature lands in their slot
  await signRecord(user, kind, id, defaultSlot(kind, user.role));
  await logAudit(user, kind.toUpperCase(), id, 'SUBMIT');

  // tell the first approver, plus any module-specific alarms
  const stages = await getStages(kind);
  await notifyEvent({ event: 'SUBMITTED', kind, recordId: id, actor: user, roles: [stages[0]?.role ?? 'MANAGER'] });
  await moduleAlarms(user, kind, id);
  return { status: 'SUBMITTED' };
}

async function moduleAlarms(user: SessionUser, kind: RecordKind, id: string) {
  if (kind === 'qc') {
    const r = await prisma.qcReport.findUniqueOrThrow({ where: { id } });
    if (r.overallResult === 'FAIL') await notifyEvent({ event: 'QC_FAILED', kind, recordId: id, actor: user });
  }
  if (kind === 'intake') {
    const r = await prisma.intakeReport.findUniqueOrThrow({ where: { id } });
    if (r.decision === 'REJECTED' || r.decision === 'ACCEPTED_DEDUCTION') {
      await notifyEvent({ event: 'INTAKE_REJECTED', kind, recordId: id, actor: user, extraLines: [r.decision === 'REJECTED' ? 'REJECTED' : 'accepted with deduction'] });
    }
  }
  if (kind === 'production') {
    const r = await prisma.productionReport.findUniqueOrThrow({ where: { id }, include: { mill: true, inputs: true, rows: { include: { product: true } } } });
    const net = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
    const total = r.rows.reduce((a, row) => a + rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)), 0);
    const main = r.rows.filter((x) => x.product.kind === 'PRODUCT').reduce((a, x) => a + rowTotalKg(x.semiFinishedKg, parsePacked(x.packedKg)), 0);
    const y = checkYields(net, total, main, r.mill);
    if (y.warnings.length) await notifyEvent({ event: 'YIELD_WARNING', kind, recordId: id, actor: user, extraLines: y.warnings });
  }
}

// ---------- approve / reject ----------

export async function approveRecord(user: SessionUser, kind: RecordKind, id: string) {
  const rec = await loadRecord(kind, id);
  if (rec.status !== 'SUBMITTED') throw new WorkflowError('Only submitted records can be approved/rejected');
  const stages = await getStages(kind);
  const stage = currentStage(stages, rec.approvalStage ?? 0);
  // orphaned mid-flow record (chain was shortened): managers may finish it
  if (stage ? !roleMayApprove(stage, user.role) : !canApprove(user.role)) {
    throw new WorkflowError(`This step is for the ${stage?.role ?? 'MANAGER'} role ("${stage?.title ?? 'approver'}")`, 403);
  }
  // sign this stage's slot, then either advance or finish
  await signRecord(user, kind, id, stage?.title ?? SLOTS[kind].approver);
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
  } else {
    await notifyEvent({ event: 'STAGE_APPROVED', kind, recordId: id, actor: user, roles: [stages[nextIdx].role], extraLines: [`Next step: "${stages[nextIdx].title}" (${stages[nextIdx].role})`] });
  }
  return { status: isFinal ? 'APPROVED' : 'SUBMITTED', stage: nextIdx, of: stages.length };
}

export async function rejectRecord(user: SessionUser, kind: RecordKind, id: string, reason: string | undefined) {
  const rec = await loadRecord(kind, id);
  if (rec.status !== 'SUBMITTED') throw new WorkflowError('Only submitted records can be approved/rejected');
  const stages = await getStages(kind);
  const stage = currentStage(stages, rec.approvalStage ?? 0);
  if (stage ? !roleMayApprove(stage, user.role) : !canApprove(user.role)) {
    throw new WorkflowError(`This step is for the ${stage?.role ?? 'MANAGER'} role ("${stage?.title ?? 'approver'}")`, 403);
  }
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
  if (!canUnlock(user.role)) throw new WorkflowError('Only a Manager or Admin can unlock', 403);
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
    if (!r.decision) missing.push('Decision (Accepted / Accepted with deduction / Rejected)');
    if ((r.decision === 'REJECTED' || r.decision === 'ACCEPTED_DEDUCTION') && !r.decisionReason?.trim())
      missing.push('Reason for the decision');
    if (r.decision === 'ACCEPTED_DEDUCTION'
        && r.weightCutKg == null && r.priceCutPerQuintal == null && r.deductionAmount == null && r.deductionRate == null)
      missing.push('At least one deduction (weight cut, price cut or flat amount)');
    if (r.decision === 'ACCEPTED_DEDUCTION' && r.pricePerQuintal == null)
      missing.push('Purchase price (₨/quintal) — needed to compute the payable amount');
    if (r.weightCutKg != null && r.weightKg != null && r.weightCutKg > r.weightKg)
      missing.push('Weight cut cannot be more than the lot weight');
    if (!r.results.some((x) => x.valueNum !== null || x.valueText)) missing.push('At least one test result');
  }
  if (kind === 'qc') {
    const r = await prisma.qcReport.findUniqueOrThrow({ where: { id }, include: { results: true } });
    if (!r.results.some((x) => x.resultNum !== null || x.resultText)) missing.push('At least one test result');
    if (!r.overallResult) missing.push('Overall Result (PASS / FAIL)');
    if (r.overallOverridden && !r.overrideReason?.trim()) missing.push('Reason for overriding the suggested result');
  }
  if (kind === 'production') {
    const r = await prisma.productionReport.findUniqueOrThrow({ where: { id }, include: { inputs: true, rows: true, downtime: true } });
    if (!r.inputs.some((i) => (i.netKg ?? 0) > 0)) missing.push('At least one raw material input with a net weight');
    if (r.inputs.some((i) => i.kantaKg != null && i.boraKg != null && i.boraKg > i.kantaKg))
      missing.push('A raw material line has bora (tare) weight heavier than kanta (gross) weight — check the weights');
    if (!r.rows.length) missing.push('At least one production row');
    if (!r.rows.some((row) => rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)) > 0)) missing.push('At least one product with output (semi-finished or packed)');
    if (!r.startTime || !r.closeTime) missing.push('Shift starting and closing time');
    if (r.downtime.some((d) => (d.fromTime && !d.toTime) || (!d.fromTime && d.toTime))) missing.push('Every downtime entry needs both From and To times');
  }
  return missing;
}
