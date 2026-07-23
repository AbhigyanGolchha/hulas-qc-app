import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, DualDate, PassFailBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function BatchesList({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await requireUser();
  const { mill } = searchParams;
  const [batches, mills] = await Promise.all([
    prisma.batch.findMany({
      where: mill ? { millId: mill } : {},
      include: {
        mill: true,
        intakeReports: true,
        productionReports: true,
        qcReports: { include: { product: true } },
      },
      orderBy: { dateAd: 'desc' },
      take: 100,
    }),
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ]);

  return (
    <Shell user={user} active="/batches">
      <PageTitle title="Batches" subtitle="The batch number is the spine: intake lots → daily production → product QC, all in one place." />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm" method="get">
        <label>Mill<br /><select name="mill" defaultValue={mill ?? ''} className="field w-44"><option value="">All</option>{mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <button className="btn-secondary">Filter</button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Mill</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2 text-center">Intake lots</th>
              <th className="px-3 py-2 text-center">Production reports</th>
              <th className="px-3 py-2">QC sheets</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-t border-stone-100 hover:bg-stone-50">
                <td className="px-3 py-2"><Link href={`/batches/${b.id}`} className="font-medium text-brand-700 hover:underline">{b.batchNo}</Link></td>
                <td className="px-3 py-2">{b.mill.name}</td>
                <td className="px-3 py-2"><DualDate ad={b.dateAd} bs={b.dateBs} /></td>
                <td className="px-3 py-2 text-center">{b.intakeReports.length}</td>
                <td className="px-3 py-2 text-center">{b.productionReports.length}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {b.qcReports.map((q) => (
                      <span key={q.id} className="inline-flex items-center gap-1 text-xs">
                        {q.product.name} <PassFailBadge result={q.overallResult} />
                      </span>
                    ))}
                    {!b.qcReports.length && <span className="text-stone-400">—</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
