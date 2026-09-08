import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle } from '@/components/ui';
import { fmtNpt } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export default async function AuditPage({ searchParams }: { searchParams: { type?: string } }) {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
  const logs = await prisma.auditLog.findMany({
    where: searchParams.type ? { recordType: searchParams.type } : {},
    orderBy: { at: 'desc' },
    take: 300,
  });
  return (
    <Shell user={user} active="/admin">
      <PageTitle title="Audit log" subtitle="Sign-ins, submits, approvals, rejections, unlocks, signatures and post-submission field edits. Times in Nepal time (GMT+5:45)." />
      <form method="get" className="mb-3 text-sm">
        <select name="type" defaultValue={searchParams.type ?? ''} className="field w-44" onChange={undefined}>
          <option value="">All record types</option>
          <option value="INTAKE">Intake</option>
          <option value="QC">Product QC</option>
          <option value="PRODUCTION">Production</option>
          <option value="AUTH">Sign-ins & passwords</option>
          <option value="SPEC">Spec changes</option>
          <option value="MASTER">Master data</option>
        </select>{' '}
        <button className="btn-secondary">Filter</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Record</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Field</th><th className="px-3 py-2">Old → New</th></tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-stone-100 align-top">
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-stone-500">{fmtNpt(l.at, { seconds: true, suffix: false })}</td>
                <td className="px-3 py-1.5">{l.userName}</td>
                <td className="px-3 py-1.5 text-xs">{l.recordType}<br /><span className="text-stone-400">{l.recordId.slice(0, 8)}</span></td>
                <td className="px-3 py-1.5 font-medium">{l.action}</td>
                <td className="px-3 py-1.5">{l.field ?? '—'}</td>
                <td className="max-w-md px-3 py-1.5 text-xs text-stone-600">
                  {l.oldValue !== null || l.newValue !== null ? (
                    <>{l.oldValue ?? '∅'} <span className="text-stone-400">→</span> {l.newValue ?? '∅'}</>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
