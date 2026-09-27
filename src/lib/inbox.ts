// Each user's own Inbox: what is waiting for THEIR signature, and what they
// have already signed. Built from the session user only — nobody can see
// another person's Inbox. "Waiting" follows the approval matrix exactly:
//  • a sign-off slot bound to the user's role that is still empty on a report
//    that can be signed (open-to-anyone slots only on reports the user started)
//  • an approval step the report is waiting on whose role is the user's
//    (plus every waiting step for an Admin while Admin step-in is on)
import { prisma } from './db';
import type { SessionUser } from './auth';
import { getPreparerSlots } from './sign';
import { adminOverride, currentStage, getStages, roleMayApprove, type RecordKind } from './approval';
import { hasRole, roleSet } from './roles';

export type InboxItem = {
  kind: RecordKind;
  id: string;
  reportNo: string;
  what: string;
  dateAd: Date;
  dateBs: string;
  status: string;
  slot: string;
  action: 'SIGN' | 'APPROVE';
  stepIn?: boolean; // Admin acting through step-in, not their own role
  signedAt?: Date;
};

const KINDS: RecordKind[] = ['intake', 'qc', 'production'];
const OPEN = ['DRAFT', 'SUBMITTED', 'REJECTED'];

type Rec = { id: string; reportNo: string; dateAd: Date; dateBs: string; status: string; approvalStage: number; createdById: string | null; what: string };

async function records(kind: RecordKind, where: object): Promise<Rec[]> {
  if (kind === 'intake') {
    const rows = await prisma.intakeReport.findMany({ where, include: { material: true, supplier: true }, orderBy: { dateAd: 'desc' } });
    return rows.map((r) => ({ ...r, what: `${r.material.name}${r.supplier ? ' · ' + r.supplier.name : ''}` }));
  }
  if (kind === 'qc') {
    const rows = await prisma.qcReport.findMany({ where, include: { product: true, batch: true }, orderBy: { dateAd: 'desc' } });
    return rows.map((r) => ({ ...r, what: `${r.product.name} · ${r.batch.batchNo}` }));
  }
  const rows = await prisma.productionReport.findMany({ where, include: { mill: true, batch: true }, orderBy: { dateAd: 'desc' } });
  return rows.map((r) => ({ ...r, what: `${r.mill.name} · ${r.batch.batchNo}` }));
}

export async function pendingFor(user: SessionUser): Promise<InboxItem[]> {
  const override = user.role === 'ADMIN' && (await adminOverride());
  const out: InboxItem[] = [];
  for (const kind of KINDS) {
    const slots = (await getPreparerSlots(kind)).filter((s) => hasRole(s.role, user.role));
    const stages = await getStages(kind);
    const mayApproveSomething = stages.some((s) => roleMayApprove(s, user.role, false)) || override;
    if (!slots.length && !mayApproveSomething) continue;

    const recs = await records(kind, { status: { in: slots.length ? OPEN : ['SUBMITTED'] } });
    if (!recs.length) continue;
    const sigs = await prisma.signature.findMany({ where: { recordType: kind.toUpperCase(), recordId: { in: recs.map((r) => r.id) } }, select: { recordId: true, slot: true } });
    const signed = new Set(sigs.map((s) => `${s.recordId}|${s.slot}`));

    for (const r of recs) {
      for (const s of slots) {
        if (signed.has(`${r.id}|${s.title}`)) continue;
        if (!roleSet(s.role).includes(user.role) && r.createdById !== user.id) continue; // open-to-anyone slots: only on reports you started
        out.push({ kind, ...r, slot: s.title, action: 'SIGN' });
      }
      if (r.status === 'SUBMITTED') {
        const stage = currentStage(stages, r.approvalStage);
        const own = stage ? roleMayApprove(stage, user.role, false) : false;
        if (stage && (own || override)) {
          out.push({ kind, ...r, slot: stage.title, action: 'APPROVE', stepIn: !own });
        }
      }
    }
  }
  // your own role's work first, Admin step-in items after; newest first within each
  return out.sort((a, b) => Number(Boolean(a.stepIn)) - Number(Boolean(b.stepIn)) || b.dateAd.getTime() - a.dateAd.getTime());
}

export async function signedBy(user: SessionUser, limit = 100): Promise<InboxItem[]> {
  const sigs = await prisma.signature.findMany({ where: { userId: user.id }, orderBy: { signedAt: 'desc' }, take: limit });
  const out: InboxItem[] = [];
  for (const kind of KINDS) {
    const mine = sigs.filter((s) => s.recordType === kind.toUpperCase());
    if (!mine.length) continue;
    const recs = new Map((await records(kind, { id: { in: [...new Set(mine.map((s) => s.recordId))] } })).map((r) => [r.id, r]));
    for (const s of mine) {
      const r = recs.get(s.recordId);
      if (r) out.push({ kind, ...r, slot: s.slot, action: 'SIGN', signedAt: s.signedAt });
    }
  }
  return out.sort((a, b) => b.signedAt!.getTime() - a.signedAt!.getTime());
}

// just the number, for the badge in the menu
export async function pendingCount(user: SessionUser): Promise<number> {
  try {
    return (await pendingFor(user)).filter((i) => !i.stepIn).length;
  } catch {
    return 0;
  }
}
