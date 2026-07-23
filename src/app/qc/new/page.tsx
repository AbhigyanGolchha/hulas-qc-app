import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { nextReportNo, suggestBatchNo, claimBatchSeq } from '@/lib/numbering';
import { adToBs, todayKathmandu } from '@/lib/dates';

export const dynamic = 'force-dynamic';

async function createQc(formData: FormData) {
  'use server';
  const user = await requireUser();
  const productId = String(formData.get('productId'));
  const dateAd = String(formData.get('dateAd') || todayKathmandu());
  const batchChoice = String(formData.get('batchId') || '');
  const newBatchNo = String(formData.get('newBatchNo') || '').trim();

  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });

  let batchId = batchChoice;
  if (!batchId) {
    const batchNo = newBatchNo || (await suggestBatchNo(product.millId));
    const existing = await prisma.batch.findUnique({ where: { millId_batchNo: { millId: product.millId, batchNo } } });
    if (existing) {
      batchId = existing.id;
    } else {
      const b = await prisma.batch.create({
        data: { millId: product.millId, batchNo, dateAd: new Date(dateAd + 'T00:00:00'), dateBs: adToBs(dateAd) },
      });
      if (!newBatchNo) await claimBatchSeq(product.millId);
      batchId = b.id;
    }
  }

  const params = await prisma.parameter.findMany({
    where: { productId, active: true },
    orderBy: { sortOrder: 'asc' },
    include: { specVersions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  const report = await prisma.qcReport.create({
    data: {
      reportNo: await nextReportNo('QC', dateAd),
      batchId,
      productId,
      dateAd: new Date(dateAd + 'T00:00:00'),
      dateBs: adToBs(dateAd),
      analyst: user.role === 'QC' ? user.name : null,
      checkedBy: user.role === 'QC' ? user.name : null,
      createdById: user.id,
      results: {
        create: params
          .filter((p) => p.specVersions.length)
          .map((p) => ({
            parameterId: p.id,
            specVersionId: p.specVersions[0].id,
            remarks: p.sampleCount === 3 ? '3 Sample' : '1 Sample',
          })),
      },
    },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, userName: user.name, recordType: 'QC', recordId: report.id, action: 'CREATE', newValue: report.reportNo },
  });
  redirect(`/qc/${report.id}`);
}

export default async function NewQc({ searchParams }: { searchParams: { batch?: string } }) {
  const user = await requireUser();
  const [products, batches] = await Promise.all([
    prisma.product.findMany({
      where: { active: true, hasQcSheet: true },
      orderBy: [{ mill: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      include: { mill: true },
    }),
    prisma.batch.findMany({ orderBy: { createdAt: 'desc' }, take: 30, include: { mill: true } }),
  ]);

  return (
    <Shell user={user} active="/qc">
      <PageTitle title="New Product QC Sheet" subtitle="Pick the product — the mill and its parameter template follow automatically." />
      <Card className="max-w-lg">
        <form action={createQc} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Product</span>
            <select name="productId" required className="field">
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.mill.name} — {p.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Batch</span>
            <select name="batchId" className="field" defaultValue={searchParams.batch ?? ''}>
              <option value="">— new batch (auto-numbered) —</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.batchNo} ({b.mill.name})</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-stone-500">
              Leave on &quot;new batch&quot; to auto-suggest the next number for the product&apos;s mill (e.g. RFM-194), or type one below.
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">New batch no. (optional override)</span>
            <input name="newBatchNo" className="field" placeholder="e.g. RFM-200" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Date (AD)</span>
            <input type="date" name="dateAd" defaultValue={todayKathmandu()} className="field" />
          </label>
          <button className="btn-primary">Create QC sheet</button>
        </form>
      </Card>
    </Shell>
  );
}
