import { prisma } from './db';
import type { SessionUser } from './auth';

export async function logAudit(
  user: SessionUser | null,
  recordType: string,
  recordId: string,
  action: string,
  field?: string,
  oldValue?: unknown,
  newValue?: unknown,
) {
  await prisma.auditLog.create({
    data: {
      userId: user?.id ?? null,
      userName: user?.name ?? 'system',
      recordType,
      recordId,
      action,
      field: field ?? null,
      oldValue: oldValue === undefined || oldValue === null ? null : String(oldValue),
      newValue: newValue === undefined || newValue === null ? null : String(newValue),
    },
  });
}

// Diff two flat objects and write one FIELD_CHANGE entry per changed field.
// Used when a previously-approved record is edited after unlock.
export async function logFieldChanges(
  user: SessionUser | null,
  recordType: string,
  recordId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    const av = a instanceof Date ? a.toISOString() : a;
    const bv = b instanceof Date ? b.toISOString() : b;
    if (String(av ?? '') !== String(bv ?? '')) {
      await logAudit(user, recordType, recordId, 'FIELD_CHANGE', key, av, bv);
    }
  }
}
