// The approval matrix — every "who may do what" on a report comes from here,
// and all of it is set by the Admin in Admin → Approval matrix. Nothing below
// names a role: roles only ever come from the database.
//
//   sign-off slots   Setting `signoff.slots`   (src/lib/sign.ts)
//   approval steps   ApprovalStage rows, in order — the last one seals the report
//   unlock roles     Setting `approval.unlock` — who may reopen an approved report
//                    and remove other people's sign-offs
//   admin step-in    Setting `approval.adminOverride` — may an Admin act on any
//                    approval step / unlock? (never on someone's sign-off slot)
//
// First-time values are written by the data fix in src/lib/data-fixes.ts, so a
// fresh or upgraded install starts with the old behaviour — as editable data.
import { prisma } from './db';
import { hasRole } from './roles';

export type RecordKind = 'intake' | 'qc' | 'production';
export type Stage = { title: string; role: string; order: number };

const UNLOCK_KEY = 'approval.unlock';
const OVERRIDE_KEY = 'approval.adminOverride';

export async function getStages(kind: RecordKind): Promise<Stage[]> {
  const rows = await prisma.approvalStage.findMany({ where: { recordType: kind.toUpperCase() }, orderBy: { order: 'asc' } });
  return rows.map((r) => ({ title: r.title, role: r.role, order: r.order }));
}

export async function adminOverride(): Promise<boolean> {
  return (await prisma.setting.findUnique({ where: { key: OVERRIDE_KEY } }))?.value === 'on';
}

export async function setAdminOverride(on: boolean) {
  const value = on ? 'on' : 'off';
  await prisma.setting.upsert({ where: { key: OVERRIDE_KEY }, create: { key: OVERRIDE_KEY, value }, update: { value } });
}

async function readJson(key: string): Promise<Record<string, string[]>> {
  const row = await prisma.setting.findUnique({ where: { key } });
  try {
    return row ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

export async function getUnlockRoles(kind: RecordKind): Promise<string[]> {
  return (await readJson(UNLOCK_KEY))[kind] ?? [];
}

export async function setUnlockRoles(kind: RecordKind, roles: string[]) {
  const all = await readJson(UNLOCK_KEY);
  all[kind] = roles;
  const value = JSON.stringify(all);
  await prisma.setting.upsert({ where: { key: UNLOCK_KEY }, create: { key: UNLOCK_KEY, value }, update: { value } });
}

// the step a SUBMITTED record is waiting on. If the Admin shortened the chain
// while a record was mid-flow, it waits on the (new) last step.
export function currentStage(stages: Stage[], approvalStage: number): Stage | null {
  if (!stages.length) return null;
  return stages[Math.min(approvalStage ?? 0, stages.length - 1)];
}

export function roleMayApprove(stage: Stage, role: string, override: boolean): boolean {
  return (hasRole(stage.role, role) && !stage.role.split(',').includes('ANY')) || (override && role === 'ADMIN');
}

// may this user approve / reject this record's current step right now?
export async function canApproveNow(kind: RecordKind, approvalStage: number, role: string): Promise<boolean> {
  const stage = currentStage(await getStages(kind), approvalStage);
  return stage ? roleMayApprove(stage, role, await adminOverride()) : false;
}

// may this user reopen an approved record / remove other people's sign-offs?
export async function canUnlockNow(kind: RecordKind, role: string): Promise<boolean> {
  if ((await getUnlockRoles(kind)).includes(role)) return true;
  return role === 'ADMIN' && (await adminOverride());
}

// The approver's own calls on a record — the intake lot Decision (+ deductions)
// and overriding a QC sheet's PASS/FAIL — belong to whoever approves the step
// the record is waiting on. Preparers fill in the tests and submit.
export async function canSetDecision(kind: RecordKind, rec: { status: string; approvalStage: number }, role: string): Promise<boolean> {
  if (role === 'ADMIN' && (await adminOverride())) return true;
  return rec.status === 'SUBMITTED' && (await canApproveNow(kind, rec.approvalStage ?? 0, role));
}
