import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { nextReportNo, suggestBatchNo, claimBatchSeq } from '@/lib/numbering';
import { adToBs, todayKathmandu } from '@/lib/dates';

export const dynamic = 'force-dynamic';

async function createProduction(formData: FormData) {
  'use server';
  const user = await requireUser();
  const millId = String(formData.get('millId'));
  const dateAd = String(formData.get('dateAd') || todayKathmandu());
  const batchChoice = String(formData.get('batchId') || '');
  const newBatchNo = String(formData.get('newBatchNo') || '').trim();

  let batchId = batchChoice;
  if (!batchId) {
    const batchNo = newBatchNo || (await suggestBatchNo(millId));
    const existing = await prisma.batch.findUnique({ where: { millId_batchNo: { millId, batchNo } } });
    if (existing) {
      batchId = existing.id;
    } else {
      const b = await prisma.batch.create({
        data: { millId, batchNo, dateAd: new Date(dateAd + 'T00:00:00'), dateBs: adToBs(dateAd) },
      });
      if (!newBatchNo) await claimBatchSeq(millId);
      batchId = b.id;
    }
  }

  // one production row per product of the mill (main products + by-products)
  const products = await prisma.product.findMany({ where: { millId, active: true }, orderBy: { sortOrder: 'asc' } });

  const report = await prisma.productionReport.create({
    data: {
      reportNo: await nextReportNo('PRODUCTION', dateAd),
      millId,
      batchId,
      dateAd: new Date(dateAd + 'T00:00:00'),
      dateBs: adToBs(dateAd),
      voltage: 380,
      preparedBy: user.role === 'SUPERVISOR' ? user.name : null,
      createdById: user.id,
      rows: { create: products.map((p, i) => ({ productId: p.id, sortOrder: i + 1 })) },
    },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, userName: user.name, recordType: 'PRODUCTION', recordId: report.id, action: 'CREATE', newValue: report.reportNo },
  });
  redirect(`/production/${report.id}`);
}

export default async function NewProduction() {
  const user = await requireUser();
  const [mills, batches] = await Promise.all([
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.batch.findMany({ orderBy: { createdAt: 'desc' }, take: 30, include: { mill: true } }),
  ]);
  const defaultMill = user.millId ?? mills[0]?.id;

  return (
    <Shell user={user} active="/production">
      <PageTitle title="New Daily Production Report" subtitle="Product rows and pack sizes load from the mill's master data." />
      <Card className="max-w-lg">
        <form action={createProduction} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Mill</span>
            <select name="millId" required defaultValue={defaultMill} className="field">
              {mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Batch</span>
            <select name="batchId" className="field">
              <option value="">— new batch (auto-numbered) —</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.batchNo} ({b.mill.name})</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">New batch no. (optional override)</span>
            <input name="newBatchNo" className="field" placeholder="e.g. RFM-200" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Date (AD)</span>
            <input type="date" name="dateAd" defaultValue={todayKathmandu()} className="field" />
          </label>
          <button className="btn-primary">Create draft report</button>
        </form>
      </Card>
    </Shell>
  );
}
