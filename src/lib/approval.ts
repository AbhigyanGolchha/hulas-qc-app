// Multi-step approval chains. The admin configures ordered stages per record
// type (Admin → Approval flow); each stage names a signature slot and the role
// that may approve it. No stages configured = the original single-approver
// flow (the SLOTS approver, approvable by MANAGER/ADMIN) — old behavior exactly.
import { prisma } from './db';
import { SLOTS, type RecordKind } from './sign';

export type Stage = { title: string; role: string; order: number };

export async function getStages(kind: RecordKind): Promise<Stage[]> {
  const rows = await prisma.approvalStage.findMany({
    where: { recordType: kind.toUpperCase() },
    orderBy: { order: 'asc' },
  });
  if (rows.length) return rows.map((r) => ({ title: r.title, role: r.role, order: r.order }));
  return [{ title: SLOTS[kind].approver, role: 'MANAGER', order: 1 }];
}

export function roleMayApprove(stage: Stage, role: string): boolean {
  return role === 'ADMIN' || role === stage.role;
}

// the stage a SUBMITTED record is currently waiting on (null when past the end,
// e.g. the admin shortened the chain while this record was mid-flow)
export function currentStage(stages: Stage[], approvalStage: number): Stage | null {
  return stages[approvalStage] ?? null;
}

// can this user act on this record right now?
export async function canApproveNow(kind: RecordKind, approvalStage: number, role: string): Promise<boolean> {
  const stages = await getStages(kind);
  const stage = currentStage(stages, approvalStage);
  if (!stage) return role === 'ADMIN' || role === 'MANAGER'; // orphaned mid-flow record — managers may finish it
  return roleMayApprove(stage, role);
}
