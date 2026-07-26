// Digital sign-offs. Each record type has named signature slots (mirroring
// the paper forms). Preparer slots are signed by people with a button or
// automatically at Submit; the approver slot is only ever filled by the
// Approve action. Unlock voids every signature — edits after signing must
// be re-signed, and the audit log keeps the trail.
import { prisma } from './db';
import type { SessionUser } from './auth';
import { logAudit } from './audit';

export type RecordKind = 'intake' | 'qc' | 'production';

export const SLOTS: Record<RecordKind, { preparers: string[]; approver: string }> = {
  intake: { preparers: ['Godown Keeper', 'Quality Controller'], approver: 'Manager' },
  qc: { preparers: ['Checked by'], approver: 'Approved by (GM)' },
  production: { preparers: ['Prepared by'], approver: 'Approved by' },
};

// which preparer slot a role naturally signs
export function defaultSlot(kind: RecordKind, role: string): string {
  if (kind === 'intake') return role === 'GODOWN' ? 'Godown Keeper' : 'Quality Controller';
  return SLOTS[kind].preparers[0];
}

// keep the legacy name columns in step so lists, CSV and SAP payloads agree
const LEGACY_FIELD: Record<string, string | null> = {
  'intake:Godown Keeper': 'godownKeeper',
  'intake:Quality Controller': 'checkedBy',
  'qc:Checked by': 'checkedBy',
  'production:Prepared by': 'preparedBy',
};

function modelFor(kind: RecordKind) {
  return kind === 'intake' ? prisma.intakeReport : kind === 'qc' ? prisma.qcReport : prisma.productionReport;
}

export async function signRecord(user: SessionUser, kind: RecordKind, recordId: string, slot: string) {
  const stageTitles = (await prisma.approvalStage.findMany({ where: { recordType: kind.toUpperCase() } })).map((s) => s.title);
  const all = [...SLOTS[kind].preparers, SLOTS[kind].approver, ...stageTitles];
  if (!all.includes(slot)) throw new Error(`Unknown signature slot "${slot}"`);
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  const recordType = kind.toUpperCase();

  await prisma.signature.upsert({
    where: { recordType_recordId_slot: { recordType, recordId, slot } },
    create: { recordType, recordId, slot, userId: user.id, userName: user.name, imageData: dbUser?.signatureData ?? null },
    update: { userId: user.id, userName: user.name, imageData: dbUser?.signatureData ?? null, signedAt: new Date() },
  });

  const legacy = LEGACY_FIELD[`${kind}:${slot}`];
  if (legacy) {
    // @ts-expect-error dynamic model union
    await modelFor(kind).update({ where: { id: recordId }, data: { [legacy]: user.name } });
  }
  await logAudit(user, recordType, recordId, 'SIGN', slot, null, user.name);
}

// Unlock = the record can change again, so existing signatures no longer
// attest to its content. Void them all; everyone re-signs on the next cycle.
export async function voidSignatures(user: SessionUser, kind: RecordKind, recordId: string) {
  const recordType = kind.toUpperCase();
  const existing = await prisma.signature.findMany({ where: { recordType, recordId } });
  if (!existing.length) return;
  await prisma.signature.deleteMany({ where: { recordType, recordId } });
  await logAudit(user, recordType, recordId, 'VOID_SIGNATURES', undefined, existing.map((s) => `${s.slot}: ${s.userName}`).join('; '), 'voided on unlock — record editable again');
}

export async function getSignatures(kind: RecordKind, recordId: string) {
  return prisma.signature.findMany({ where: { recordType: kind.toUpperCase(), recordId }, orderBy: { signedAt: 'asc' } });
}

// slot list + current signatures, shaped for the SignoffPanel component.
// Approver slots come from the configured approval chain (Admin → Approval
// flow); with no chain configured this is the single built-in approver slot.
export async function slotViews(kind: RecordKind, recordId: string) {
  const stages = await prisma.approvalStage.findMany({ where: { recordType: kind.toUpperCase() }, orderBy: { order: 'asc' } });
  const approverSlots = stages.length ? stages.map((s) => s.title) : [SLOTS[kind].approver];
  // @ts-expect-error dynamic model union
  const rec = await modelFor(kind).findUnique({ where: { id: recordId }, select: { approvalStage: true } });
  const done = rec?.approvalStage ?? 0;

  const sigs = await getSignatures(kind, recordId);
  const bySlot = new Map(sigs.map((s) => [s.slot, s]));
  return [
    ...SLOTS[kind].preparers.map((slot) => ({ slot, isApprover: false, isCurrentStage: false })),
    ...approverSlots.map((slot, i) => ({ slot, isApprover: true, isCurrentStage: i === done })),
  ].map((base) => {
    const s = bySlot.get(base.slot);
    return {
      ...base,
      signedBy: s?.userName ?? null,
      signedAt: s?.signedAt.toISOString() ?? null,
      imageData: s?.imageData ?? null,
    };
  });
}
