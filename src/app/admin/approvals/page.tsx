import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { logAudit } from '@/lib/audit';
import { ROLES } from '@/lib/constants';
import { SLOTS } from '@/lib/sign';

export const dynamic = 'force-dynamic';

const TYPES = [
  { key: 'INTAKE', kind: 'intake' as const, label: 'Raw Material Intake (spot analysis)' },
  { key: 'QC', kind: 'qc' as const, label: 'Finished Product QC' },
  { key: 'PRODUCTION', kind: 'production' as const, label: 'Daily Production' },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  QC: 'QC analyst',
  SUPERVISOR: 'Mill supervisor',
  GODOWN: 'Godown keeper',
};

async function guard() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
  return user;
}

async function renumber(recordType: string) {
  const rows = await prisma.approvalStage.findMany({ where: { recordType }, orderBy: { order: 'asc' } });
  // two passes so the (recordType, order) unique constraint never collides mid-shuffle
  for (let i = 0; i < rows.length; i++) await prisma.approvalStage.update({ where: { id: rows[i].id }, data: { order: 1000 + i } });
  for (let i = 0; i < rows.length; i++) await prisma.approvalStage.update({ where: { id: rows[i].id }, data: { order: i + 1 } });
}

async function addStage(formData: FormData) {
  'use server';
  const user = await guard();
  const recordType = String(formData.get('recordType'));
  const title = String(formData.get('title') || '').trim();
  const role = String(formData.get('role'));
  if (!title) redirect('/admin/approvals?err=' + encodeURIComponent('The approval step needs a title (it becomes the signature slot).'));
  const last = await prisma.approvalStage.findFirst({ where: { recordType }, orderBy: { order: 'desc' } });
  await prisma.approvalStage.create({ data: { recordType, order: (last?.order ?? 0) + 1, title, role } });
  await logAudit(user, 'MASTER', recordType, 'CREATE', 'approval-stage', null, `${title} (${role})`);
  redirect('/admin/approvals?msg=' + encodeURIComponent(`Step "${title}" added to ${recordType.toLowerCase()} approvals.`));
}

async function removeStage(formData: FormData) {
  'use server';
  const user = await guard();
  const id = String(formData.get('id'));
  const s = await prisma.approvalStage.findUniqueOrThrow({ where: { id } });
  await prisma.approvalStage.delete({ where: { id } });
  await renumber(s.recordType);
  await logAudit(user, 'MASTER', s.recordType, 'UPDATE', 'approval-stage', `${s.title} (${s.role})`, 'removed');
  redirect('/admin/approvals');
}

async function moveStage(formData: FormData) {
  'use server';
  await guard();
  const id = String(formData.get('id'));
  const dir = String(formData.get('dir'));
  const s = await prisma.approvalStage.findUniqueOrThrow({ where: { id } });
  const neighbor = await prisma.approvalStage.findFirst({
    where: { recordType: s.recordType, order: dir === 'up' ? { lt: s.order } : { gt: s.order } },
    orderBy: { order: dir === 'up' ? 'desc' : 'asc' },
  });
  if (neighbor) {
    // swap via a parking value so the unique constraint stays happy
    await prisma.approvalStage.update({ where: { id: s.id }, data: { order: 9999 } });
    const a = neighbor.order;
    await prisma.approvalStage.update({ where: { id: neighbor.id }, data: { order: s.order } });
    await prisma.approvalStage.update({ where: { id: s.id }, data: { order: a } });
  }
  redirect('/admin/approvals');
}

export default async function ApprovalsAdmin({ searchParams }: { searchParams: { msg?: string; err?: string } }) {
  const user = await guard();
  const all = await prisma.approvalStage.findMany({ orderBy: { order: 'asc' } });

  return (
    <Shell user={user} active="/admin">
      <PageTitle
        title="Approval flow"
        subtitle="Who signs off, and in what order, before a report is final. One step = the classic single approval. Add more steps for a chain — the report only reaches SAP after the LAST step approves."
      />
      {searchParams.msg && <div className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.msg}</div>}
      {searchParams.err && <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{searchParams.err}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {TYPES.map((t) => {
          const stages = all.filter((s) => s.recordType === t.key);
          return (
            <Card key={t.key} title={t.label}>
              {stages.length === 0 && (
                <p className="mb-3 rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                  Using the built-in flow: one approval by a <b>Manager</b> (slot &quot;{SLOTS[t.kind].approver}&quot;).
                  Add steps below to replace it.
                </p>
              )}
              <ol className="space-y-2">
                {stages.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-lg border border-stone-200 p-2 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.title}</span>
                      <br /><span className="text-xs text-stone-500">approved by: {ROLE_LABELS[s.role] ?? s.role} (Admin can always step in)</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {i > 0 && (
                        <form action={moveStage}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value="up" /><button className="rounded border border-stone-200 px-1.5 text-xs text-stone-500 hover:bg-stone-50" title="move up">↑</button></form>
                      )}
                      {i < stages.length - 1 && (
                        <form action={moveStage}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value="down" /><button className="rounded border border-stone-200 px-1.5 text-xs text-stone-500 hover:bg-stone-50" title="move down">↓</button></form>
                      )}
                      <form action={removeStage}><input type="hidden" name="id" value={s.id} /><button className="rounded border border-stone-200 px-1.5 text-xs text-red-600 hover:bg-red-50" title="remove">✕</button></form>
                    </span>
                  </li>
                ))}
              </ol>
              <form action={addStage} className="mt-3 space-y-2 rounded-lg border border-dashed border-stone-300 p-3 text-sm">
                <input type="hidden" name="recordType" value={t.key} />
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Add step {stages.length + 1}</div>
                <label className="block">Step title (becomes the signature slot)<br />
                  <input name="title" required className="field" placeholder={stages.length === 0 ? 'e.g. Mill Supervisor' : 'e.g. General Manager'} />
                </label>
                <label className="block">Who approves this step<br />
                  <select name="role" className="field" defaultValue="MANAGER">
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>)}
                  </select>
                </label>
                <button className="btn-secondary">Add step</button>
              </form>
            </Card>
          );
        })}
      </div>

      <p className="mt-4 max-w-3xl rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
        Changes apply to reports approved from now on. A report already mid-chain keeps its progress; if you shorten a chain
        below a report&apos;s progress, a Manager can finish it. Rejection at any step sends the report back to the editor and
        clears approval signatures. Nothing reaches SAP until the final step approves.
      </p>
    </Shell>
  );
}
