import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, StatusBadge, DualDate } from '@/components/ui';
import { DECISIONS, type Decision } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function IntakeList({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await requireUser();
  const { material, status, supplier, from, to } = searchParams;

  const where: any = {};
  if (material) where.materialId = material;
  if (status) where.status = status;
  if (supplier) where.supplierId = supplier;
  if (from || to) where.dateAd = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + 'T23:59:59') } : {}) };

  const [reports, materials, suppliers] = await Promise.all([
    prisma.intakeReport.findMany({
      where,
      include: { material: true, supplier: true, mill: true, results: true },
      orderBy: { dateAd: 'desc' },
      take: 200,
    }),
    prisma.material.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ]);

  const csvQs = new URLSearchParams({ type: 'intake', ...searchParams }).toString();

  return (
    <Shell user={user} active="/intake">
      <PageTitle title="Raw Material Intake — Spot Analysis" subtitle="One report per incoming vehicle/lot, tested at the gate.">
        <a className="btn-secondary" href={`/api/csv?${csvQs}`}>Export CSV</a>
        <Link className="btn-primary" href="/intake/new">+ New spot analysis</Link>
      </PageTitle>

      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
        <label>Material<br /><select name="material" defaultValue={material ?? ''} className="field w-36"><option value="">All</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Supplier<br /><select name="supplier" defaultValue={supplier ?? ''} className="field w-48"><option value="">All</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Status<br /><select name="status" defaultValue={status ?? ''} className="field w-32"><option value="">All</option><option>DRAFT</option><option>SUBMITTED</option><option>APPROVED</option><option>REJECTED</option></select></label>
        <label>From (AD)<br /><input type="date" name="from" defaultValue={from ?? ''} className="field w-36" /></label>
        <label>To (AD)<br /><input type="date" name="to" defaultValue={to ?? ''} className="field w-36" /></label>
        <button className="btn-secondary">Filter</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">Report</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Material</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Vehicle</th>
              <th className="px-3 py-2 text-right">Weight (kg)</th>
              <th className="px-3 py-2">Decision</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50">
                <td className="px-3 py-2"><Link href={`/intake/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.reportNo}</Link></td>
                <td className="px-3 py-2"><DualDate ad={r.dateAd} bs={r.dateBs} /></td>
                <td className="px-3 py-2">{r.material.name}{r.variety ? ` — ${r.variety}` : ''}</td>
                <td className="px-3 py-2">{r.supplier?.name ?? '—'}</td>
                <td className="px-3 py-2">{r.vehicleNo ?? '—'}</td>
                <td className="px-3 py-2 text-right">{r.weightKg?.toLocaleString('en-IN') ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{r.decision ? DECISIONS[r.decision as Decision] : '—'}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {!reports.length && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-stone-400">No intake reports match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
