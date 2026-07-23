import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle } from '@/components/ui';
import { IntakeForm, type IntakeFormData } from '@/components/intake-form';
import { canApprove, canUnlock } from '@/lib/constants';
import { adIso, formatMiti } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export default async function IntakePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const r = await prisma.intakeReport.findUnique({
    where: { id: params.id },
    include: {
      material: true,
      results: { include: { parameter: true, specVersion: true }, orderBy: { parameter: { sortOrder: 'asc' } } },
    },
  });
  if (!r) notFound();

  const [mills, suppliers] = await Promise.all([
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const initial: IntakeFormData = {
    id: r.id,
    reportNo: r.reportNo,
    status: r.status,
    materialName: r.material.name,
    header: {
      dateAd: adIso(r.dateAd),
      dateBs: r.dateBs,
      millId: r.millId,
      supplierId: r.supplierId,
      variety: r.variety ?? '',
      challanNo: r.challanNo ?? '',
      vehicleNo: r.vehicleNo ?? '',
      unloadingPlace: r.unloadingPlace ?? '',
      weightKg: r.weightKg?.toString() ?? '',
      bags: r.bags?.toString() ?? '',
      bagType: r.bagType ?? '',
      season: r.season ?? '',
      decision: r.decision ?? '',
      decisionReason: r.decisionReason ?? '',
      pricePerQuintal: r.pricePerQuintal?.toString() ?? '',
      weightCutKg: r.weightCutKg?.toString() ?? '',
      priceCutPerQuintal: r.priceCutPerQuintal?.toString() ?? '',
      deductionAmount: r.deductionAmount?.toString() ?? '',
      deductionRate: r.deductionRate?.toString() ?? '',
      godownKeeper: r.godownKeeper ?? '',
      checkedBy: r.checkedBy ?? '',
    },
    rows: r.results.map((res) => ({
      parameterId: res.parameterId,
      name: res.parameter.name,
      unit: res.parameter.unit,
      valueType: res.parameter.valueType,
      options: res.parameter.options ? JSON.parse(res.parameter.options) : null,
      spec: {
        operator: res.specVersion.operator,
        min: res.specVersion.min,
        max: res.specVersion.max,
        textExpected: res.specVersion.textExpected,
        displayText: res.specVersion.displayText,
        sourceTag: res.specVersion.sourceTag,
      },
      valueNum: res.valueNum,
      valueText: res.valueText,
      note: res.note,
    })),
  };

  return (
    <Shell user={user} active="/intake">
      <PageTitle
        title={`Spot Analysis ${r.reportNo} — ${r.material.name}`}
        subtitle={<>Date {adIso(r.dateAd)} · Miti {formatMiti(r.dateBs)} · blank result = not tested (that&apos;s fine)</>}
      />
      <IntakeForm initial={initial} mills={mills} suppliers={suppliers} canApprove={canApprove(user.role)} canUnlock={canUnlock(user.role)} />
    </Shell>
  );
}
