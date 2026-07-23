import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { nextReportNo } from '@/lib/numbering';
import { adToBs, todayKathmandu } from '@/lib/dates';

export const dynamic = 'force-dynamic';

async function createDraft(formData: FormData) {
  'use server';
  const user = await requireUser();
  const materialId = String(formData.get('materialId'));
  const dateAd = String(formData.get('dateAd') || todayKathmandu());
  const millId = String(formData.get('millId') || '') || null;

  // snapshot the template: one result row per active parameter, pinned to the
  // latest spec version (spec changes later never rewrite this report)
  const params = await prisma.parameter.findMany({
    where: { materialId, active: true },
    orderBy: { sortOrder: 'asc' },
    include: { specVersions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  const report = await prisma.intakeReport.create({
    data: {
      reportNo: await nextReportNo('INTAKE', dateAd),
      materialId,
      millId,
      dateAd: new Date(dateAd + 'T00:00:00'),
      dateBs: adToBs(dateAd),
      checkedBy: user.role === 'QC' ? user.name : null,
      createdById: user.id,
      results: {
        create: params
          .filter((p) => p.specVersions.length)
          .map((p) => ({ parameterId: p.id, specVersionId: p.specVersions[0].id })),
      },
    },
  });
  await prisma.auditLog.create({
    data: { userId: user.id, userName: user.name, recordType: 'INTAKE', recordId: report.id, action: 'CREATE', newValue: report.reportNo },
  });
  redirect(`/intake/${report.id}`);
}

export default async function NewIntake() {
  const user = await requireUser();
  const [materials, mills] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  return (
    <Shell user={user} active="/intake">
      <PageTitle title="New Spot Analysis" subtitle="Pick the material — its test template loads automatically." />
      <Card className="max-w-lg">
        <form action={createDraft} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Material</span>
            <select name="materialId" required className="field">
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Destination mill</span>
            <select name="millId" className="field">
              <option value="">— not decided yet —</option>
              {mills.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
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
