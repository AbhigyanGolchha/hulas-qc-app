import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card, StatusBadge, PassFailBadge, DualDate } from '@/components/ui';
import { adIso, addDays, adToBs, formatMiti, formatAdLong } from '@/lib/dates';
import { fmtKg, parsePacked, rowTotalKg } from '@/lib/calc';
import { DECISIONS, type Decision } from '@/lib/constants';
import { isSapEnabled } from '@/lib/connector';

export const dynamic = 'force-dynamic';

async function saveSapOrderNo(formData: FormData) {
  'use server';
  const user = await requireUser();
  const batchId = String(formData.get('batchId'));
  const sapOrderNo = String(formData.get('sapOrderNo') || '').trim() || null;
  const before = await prisma.batch.findUnique({ where: { id: batchId } });
  await prisma.batch.update({ where: { id: batchId }, data: { sapOrderNo } });
  await prisma.auditLog.create({
    data: { userId: user.id, userName: user.name, recordType: 'MASTER', recordId: batchId, action: 'UPDATE', field: 'batch.sapOrderNo', oldValue: before?.sapOrderNo ?? null, newValue: sapOrderNo },
  });
  revalidatePath(`/batches/${batchId}`);
}

async function addRetentionSample(formData: FormData) {
  'use server';
  await requireUser();
  const batchId = String(formData.get('batchId'));
  const productName = String(formData.get('productName') || '').trim();
  const location = String(formData.get('location') || '').trim();
  const reviewDate = String(formData.get('reviewDate') || '');
  if (!productName || !location) return;
  await prisma.retentionSample.create({
    data: { batchId, productName, location, reviewDate: reviewDate ? new Date(reviewDate + 'T00:00:00') : null },
  });
  revalidatePath(`/batches/${batchId}`);
}

export default async function BatchPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const b = await prisma.batch.findUnique({
    where: { id: params.id },
    include: {
      mill: true,
      intakeReports: { include: { material: true, supplier: true }, orderBy: { dateAd: 'asc' } },
      productionReports: { include: { inputs: true, rows: { include: { product: true } } }, orderBy: { dateAd: 'asc' } },
      qcReports: { include: { product: true }, orderBy: { product: { sortOrder: 'asc' } } },
      retentionSamples: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!b) notFound();

  const products = await prisma.product.findMany({ where: { millId: b.millId, active: true, kind: 'PRODUCT' }, orderBy: { sortOrder: 'asc' } });
  const batchDateIso = adIso(b.dateAd);

  return (
    <Shell user={user} active="/batches">
      <PageTitle
        title={`Batch ${b.batchNo} — ${b.mill.name}`}
        subtitle={<DualDate ad={b.dateAd} bs={b.dateBs} />}
      >
        <Link className="btn-secondary" href={`/qc/new?batch=${b.id}`}>+ QC sheet</Link>
      </PageTitle>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="1 · Raw material intake consumed">
          {b.intakeReports.length ? (
            <ul className="space-y-2 text-sm">
              {b.intakeReports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/intake/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.reportNo}</Link>
                  <span>{r.material.name}{r.variety ? ` (${r.variety})` : ''}</span>
                  <span className="text-stone-500">{r.supplier?.name}</span>
                  <span>{fmtKg(r.weightKg)} kg</span>
                  <span className="text-xs text-stone-500">{r.decision ? DECISIONS[r.decision as Decision] : 'decision pending'}</span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-400">No intake lots linked to this batch yet.</p>
          )}
        </Card>

        <Card title="2 · Daily production">
          {b.productionReports.length ? (
            <ul className="space-y-3 text-sm">
              {b.productionReports.map((r) => {
                const net = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
                const out = r.rows.reduce((a, row) => a + rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)), 0);
                return (
                  <li key={r.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/production/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.reportNo}</Link>
                      <span>net input {fmtKg(net)} kg → output {fmtKg(out)} kg</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="mt-1 text-xs text-stone-500">
                      {r.rows.filter((row) => rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)) > 0)
                        .map((row) => `${row.product.name} ${fmtKg(rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)))} kg`)
                        .join(' · ')}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-stone-400">No production report yet. <Link className="text-brand-700 hover:underline" href="/production/new">Create one.</Link></p>
          )}
        </Card>

        <Card title="3 · Product QC sheets">
          {b.qcReports.length ? (
            <ul className="space-y-2 text-sm">
              {b.qcReports.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/qc/${q.id}`} className="font-medium text-brand-700 hover:underline">{q.reportNo}</Link>
                  <span>{q.product.name}</span>
                  <PassFailBadge result={q.overallResult} />
                  <StatusBadge status={q.status} />
                  {q.remarks && <span className="text-xs text-stone-500">“{q.remarks}”</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-400">No QC sheets yet.</p>
          )}
        </Card>

        <Card title="Best-before dates (for label printing)">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr><th className="py-1">Product</th><th className="py-1">Shelf life</th><th className="py-1">Best before (AD)</th><th className="py-1">Best before (BS)</th></tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const bb = p.shelfLifeDays ? addDays(batchDateIso, p.shelfLifeDays) : null;
                return (
                  <tr key={p.id} className="border-t border-stone-100">
                    <td className="py-1.5 font-medium">{p.name}</td>
                    <td className="py-1.5">{p.shelfLifeDays ? `${p.shelfLifeDays} days` : '—'}</td>
                    <td className="py-1.5">{bb ? formatAdLong(bb) : '—'}</td>
                    <td className="py-1.5">{bb ? `Miti ${formatMiti(adToBs(bb))}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {(await isSapEnabled()) && (
        <Card title="SAP reference" className="mt-4">
          <form action={saveSapOrderNo} className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="batchId" value={b.id} />
            <label>SAP production order no. (for confirmations)<br />
              <input name="sapOrderNo" defaultValue={b.sapOrderNo ?? ''} className="field w-56" placeholder="e.g. 1000123" />
            </label>
            <button className="btn-secondary">Save</button>
            <span className="text-xs text-stone-400">Production reports for this batch confirm against this order (documents mode only).</span>
          </form>
        </Card>
      )}

      <Card title="Retention sample register (optional)" className="mt-4">
        {b.retentionSamples.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm">
            {b.retentionSamples.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.productName}</span> — {s.location}
                {s.reviewDate && <span className="text-stone-500"> · review {adIso(s.reviewDate)}</span>}
              </li>
            ))}
          </ul>
        )}
        <form action={addRetentionSample} className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="batchId" value={b.id} />
          <label>Product<br />
            <select name="productName" className="field w-44">{products.map((p) => <option key={p.id}>{p.name}</option>)}</select>
          </label>
          <label>Location<br /><input name="location" className="field w-44" placeholder="Lab shelf B-2" /></label>
          <label>Review date<br /><input type="date" name="reviewDate" className="field w-40" /></label>
          <button className="btn-secondary">Add sample</button>
        </form>
      </Card>
    </Shell>
  );
}
