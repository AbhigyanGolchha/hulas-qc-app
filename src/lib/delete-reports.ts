// Deleting reports — only for roles with the "Delete reports" permission
// (Admin by default; Admin → Roles & permissions). Works for any status, one
// report or many. The audit log keeps a row per deleted report (number,
// status, who, when) even though the report itself is gone.
import { prisma } from './db';
import type { SessionUser } from './auth';
import { logAudit } from './audit';
import type { RecordKind } from './approval';

export class DeleteError extends Error {}

export async function deleteReports(user: SessionUser, kind: RecordKind, ids: string[]): Promise<number> {
  if (!user.permissions.includes('reports.delete')) throw new DeleteError('Your role may not delete reports (Admin → Roles & permissions).');
  const recordType = kind.toUpperCase();
  let n = 0;
  for (const id of [...new Set(ids)]) {
    const rec =
      kind === 'intake' ? await prisma.intakeReport.findUnique({ where: { id }, select: { reportNo: true, status: true } })
      : kind === 'qc' ? await prisma.qcReport.findUnique({ where: { id }, select: { reportNo: true, status: true } })
      : await prisma.productionReport.findUnique({ where: { id }, select: { reportNo: true, status: true } });
    if (!rec) continue;
    await logAudit(user, recordType, id, 'DELETE', undefined, rec.status, `${rec.reportNo} (${rec.status}) deleted`);
    await prisma.signature.deleteMany({ where: { recordType, recordId: id } });
    await prisma.notification.updateMany({ where: { recordId: id, status: { in: ['PENDING', 'SKIPPED'] } }, data: { status: 'SKIPPED', lastError: 'record deleted' } });
    await prisma.integrationOutbox.deleteMany({ where: { recordId: id } });
    if (kind === 'intake') {
      // production reports that drew from this lot keep their weights, just lose the link
      await prisma.productionInput.updateMany({ where: { intakeReportId: id }, data: { intakeReportId: null } });
      await prisma.intakeReport.delete({ where: { id } });
    } else if (kind === 'qc') {
      await prisma.qcReport.delete({ where: { id } });
    } else {
      await prisma.productionReport.delete({ where: { id } }); // inputs/rows/downtime cascade
    }
    n++;
  }
  return n;
}
