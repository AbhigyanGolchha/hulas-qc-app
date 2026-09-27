import Link from 'next/link';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import { requireUser, requirePermission } from '@/lib/auth';
import { deleteReports } from '@/lib/delete-reports';
import { SelectAll, BulkDeleteButton } from '@/components/bulk-select';
import { Shell } from '@/components/shell';
import { PageTitle, StatusBadge, DualDate } from '@/components/ui';
import { fmtKg } from '@/lib/calc';

export const dynamic = 'force-dynamic';

// Admin-only (the "Delete reports" permission): delete the ticked reports.
async function massDelete(formData: FormData) {
  'use server';
  const user = await requirePermission('reports.delete');
  const n = await deleteReports(user, 'production', formData.getAll('ids').map(String));
  redirect(`/production?deleted=${n}`);
}

export default async function ProductionList({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await requireUser();
  const canDelete = user.permissions.includes('reports.delete');
  const { mill, status, from, to } = searchParams;
  const where: any = {};
  if (mill) where.millId = mill;
  if (status) where.status = status;
  if (from || to) where.dateAd = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + 'T23:59:59') } : {}) };

  const [reports, mills] = await Promise.all([
    prisma.productionReport.findMany({
      where,
      include: { mill: true, batch: true, inputs: true },
      orderBy: { dateAd: 'desc' },
      take: 200,
    }),
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  const csvQs = new URLSearchParams({ type: 'production', ...searchParams }).toString();

  return (
    <Shell user={user} active="/production">
      <PageTitle title="Daily Production Reports" subtitle="One per mill per production day/batch.">
        <a className="btn-secondary" href={`/api/csv?${csvQs}`}>Export CSV</a>
        {user.permissions.includes('production.edit') && (<Link className="btn-primary" href="/production/new">+ New daily report</Link>)}
        {canDelete && <BulkDeleteButton formId="bulk-delete" noun="report" />}
      </PageTitle>
      {canDelete && <form id="bulk-delete" action={massDelete} className="hidden" />}
      {searchParams.deleted && <div className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.deleted} report(s) deleted. The audit log keeps a record of each deletion.</div>}

      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
        <label>Mill<br /><select name="mill" defaultValue={mill ?? ''} className="field w-44"><option value="">All</option>{mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Status<br /><select name="status" defaultValue={status ?? ''} className="field w-32"><option value="">All</option><option>DRAFT</option><option>SUBMITTED</option><option>APPROVED</option><option>REJECTED</option></select></label>
        <label>From (AD)<br /><input type="date" name="from" defaultValue={from ?? ''} className="field w-36" /></label>
        <label>To (AD)<br /><input type="date" name="to" defaultValue={to ?? ''} className="field w-36" /></label>
        <button className="btn-secondary">Filter</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              {canDelete && <th className="w-8 px-3 py-2"><SelectAll formId="bulk-delete" /></th>}
              <th className="px-3 py-2">Report</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Mill</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2 text-right">Net input (kg)</th>
              <th className="px-3 py-2">Shift</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50">
                {canDelete && <td className="px-3 py-2"><input type="checkbox" name="ids" value={r.id} form="bulk-delete" aria-label={`Select ${r.reportNo}`} /></td>}
                <td className="px-3 py-2"><Link href={`/production/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.reportNo}</Link></td>
                <td className="px-3 py-2"><DualDate ad={r.dateAd} bs={r.dateBs} /></td>
                <td className="px-3 py-2">{r.mill.name}</td>
                <td className="px-3 py-2"><Link href={`/batches/${r.batchId}`} className="text-brand-700 hover:underline">{r.batch.batchNo}</Link></td>
                <td className="px-3 py-2 text-right">{fmtKg(r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0))}</td>
                <td className="px-3 py-2">{r.startTime && r.closeTime ? `${r.startTime}–${r.closeTime}` : '—'}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {!reports.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-400">No production reports match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
