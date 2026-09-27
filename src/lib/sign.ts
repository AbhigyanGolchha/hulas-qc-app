// Digital sign-offs. Each record type has named signature slots (mirroring
// the paper forms), all set by the Admin in Admin → Approval matrix:
//  • sign-off slots ("Godown Keeper", "Quality Controller", …) — each bound to
//    one role; only users with that role get a button and the API refuses
//    everyone else (Admins included). Submit auto-signs the submitter's slot.
//  • approval-step slots — one per approval step, filled only by Approve.
// Nothing here names a slot or a role; they come from the database.
// Unlock voids every signature — edits after signing must be re-signed, and
// the audit log keeps the trail.
import { prisma } from './db';
import type { SessionUser } from './auth';
import { logAudit } from './audit';
import { ROLE_LABELS, type Role } from './constants';
import { canUnlockNow, getStages, type RecordKind } from './approval';

export type { RecordKind };

// A sign-off slot: its title (what prints under the signature) and the role
// allowed to sign it. 'ANY' = anyone who can edit the record.
export type SlotDef = { title: string; role: string };

const SLOTS_KEY = 'signoff.slots';

export async function getPreparerSlots(kind: RecordKind): Promise<SlotDef[]> {
  const row = await prisma.setting.findUnique({ where: { key: SLOTS_KEY } });
  if (row) {
    try {
      const all = JSON.parse(row.value);
      if (Array.isArray(all?.[kind])) return all[kind];
    } catch {
      // unreadable setting — treated as no sign-off slots
    }
  }
  return [];
}

export async function savePreparerSlots(kind: RecordKind, slots: SlotDef[]) {
  const row = await prisma.setting.findUnique({ where: { key: SLOTS_KEY } });
  let all: Record<string, SlotDef[]> = {};
  try {
    all = row ? JSON.parse(row.value) : {};
  } catch {
    all = {};
  }
  all[kind] = slots;
  const value = JSON.stringify(all);
  await prisma.setting.upsert({ where: { key: SLOTS_KEY }, create: { key: SLOTS_KEY, value }, update: { value } });
}

export function roleMaySign(slot: SlotDef, role: string): boolean {
  return slot.role === 'ANY' || slot.role === role;
}

export function slotRoleLabel(role: string): string {
  return role === 'ANY' ? 'anyone who can edit the report' : ROLE_LABELS[role as Role] ?? role;
}

// the preparer slot a submitter signs automatically: the one bound to their
// role, else an open ('ANY') slot, else none — submitting never signs a slot
// that belongs to somebody else's role.
export async function defaultSlot(kind: RecordKind, role: string): Promise<string | null> {
  const slots = await getPreparerSlots(kind);
  return (slots.find((s) => s.role === role) ?? slots.find((s) => s.role === 'ANY'))?.title ?? null;
}

// Mirror signatures into the old name columns (lists, CSV, SAP payload) for
// slots that existed before sign-offs were configurable. Display only — no
// permission depends on this.
const LEGACY_FIELD: Record<string, string | null> = {
  'intake:Godown Keeper': 'godownKeeper',
  'intake:Quality Controller': 'checkedBy',
  'qc:Checked by': 'checkedBy',
  'production:Prepared by': 'preparedBy',
};

function modelFor(kind: RecordKind) {
  return kind === 'intake' ? prisma.intakeReport : kind === 'qc' ? prisma.qcReport : prisma.productionReport;
}

// viaApproval: the Approve action signing its own stage slot. Every other
// caller may only sign preparer slots, and only with the slot's role.
export async function signRecord(user: SessionUser, kind: RecordKind, recordId: string, slot: string, opts: { viaApproval?: boolean } = {}) {
  const approverSlots = (await getStages(kind)).map((s) => s.title);
  const preparer = (await getPreparerSlots(kind)).find((s) => s.title === slot);
  if (opts.viaApproval) {
    if (!approverSlots.includes(slot)) throw new Error(`Unknown approval slot "${slot}"`);
  } else {
    if (approverSlots.includes(slot) && !preparer) throw new Error('Approval slots are signed by the Approve action, not here.');
    if (!preparer) throw new Error(`Unknown signature slot "${slot}"`);
    if (!roleMaySign(preparer, user.role)) {
      throw new Error(`Only a ${slotRoleLabel(preparer.role)} can sign as "${slot}".`);
    }
  }
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

// Withdraw one signature while the record is still editable. The person who
// signed may remove their own; the unlock roles from the approval matrix may
// remove anyone's (audited either way). Approver slots are never removed this way — that is what
// Reject and Unlock are for, because they also roll the approval state back.
export async function unsignRecord(user: SessionUser, kind: RecordKind, recordId: string, slot: string) {
  const recordType = kind.toUpperCase();
  const stageTitles = (await getStages(kind)).map((s) => s.title);
  if (stageTitles.includes(slot)) {
    throw new Error('Approval signatures are removed by Reject or Unlock, not here.');
  }
  const sig = await prisma.signature.findUnique({ where: { recordType_recordId_slot: { recordType, recordId, slot } } });
  if (!sig) return;
  if (sig.userId !== user.id && !(await canUnlockNow(kind, user.role))) {
    throw new Error('Only the person who signed (or someone allowed to unlock these reports) can remove this signature.');
  }
  await prisma.signature.delete({ where: { id: sig.id } });
  const legacy = LEGACY_FIELD[`${kind}:${slot}`];
  if (legacy) {
    // @ts-expect-error dynamic model union
    await modelFor(kind).update({ where: { id: recordId }, data: { [legacy]: null } });
  }
  await logAudit(user, recordType, recordId, 'UNSIGN', slot, sig.userName, sig.userId === user.id ? 'removed own signature' : `removed by ${user.name}`);
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
// Approver slots are the approval steps from Admin → Approval matrix.
export async function slotViews(kind: RecordKind, recordId: string, viewerRole?: string) {
  const approverSlots = (await getStages(kind)).map((s) => s.title);
  // @ts-expect-error dynamic model union
  const rec = await modelFor(kind).findUnique({ where: { id: recordId }, select: { approvalStage: true } });
  const done = rec?.approvalStage ?? 0;
  const preparers = await getPreparerSlots(kind);

  // who may sign each preparer slot, by name — so the panel can say "for: Ram, Sita"
  const roles = [...new Set(preparers.map((p) => p.role).filter((r) => r !== 'ANY'))];
  const eligible = roles.length
    ? await prisma.user.findMany({ where: { active: true, role: { in: roles } }, select: { name: true, role: true }, orderBy: { name: 'asc' } })
    : [];

  const sigs = await getSignatures(kind, recordId);
  const bySlot = new Map(sigs.map((s) => [s.slot, s]));
  return [
    ...preparers.map((p) => ({
      slot: p.title,
      isApprover: false,
      isCurrentStage: false,
      signerRole: slotRoleLabel(p.role),
      eligibleNames: p.role === 'ANY' ? [] : eligible.filter((u) => u.role === p.role).map((u) => u.name),
      canSign: viewerRole ? roleMaySign(p, viewerRole) : false,
    })),
    ...approverSlots.map((slot, i) => ({ slot, isApprover: true, isCurrentStage: i === Math.min(done, approverSlots.length - 1), signerRole: null, eligibleNames: [] as string[], canSign: false })),
  ].map((base) => {
    const s = bySlot.get(base.slot);
    return {
      ...base,
      signedBy: s?.userName ?? null,
      signedById: s?.userId ?? null,
      signedAt: s?.signedAt.toISOString() ?? null,
      imageData: s?.imageData ?? null,
    };
  });
}

// declared print slots: sign-off slots, then the approval steps. Records
// approved before digital signatures show the old approvedBy name on the last step.
export async function printSlots(
  kind: RecordKind,
  legacy: Record<string, string | null | undefined>,
  approver: { name: string | null; at: Date | null },
) {
  const preparers = await getPreparerSlots(kind);
  const stages = await getStages(kind);
  return [
    ...preparers.map((p) => ({ slot: p.title, legacyName: legacy[p.title] ?? null })),
    ...stages.map((st, i) => (i === stages.length - 1
      ? { slot: st.title, legacyName: approver.name, legacyAt: approver.at }
      : { slot: st.title, legacyName: null as string | null })),
  ];
}
