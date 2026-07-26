import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle } from '@/components/ui';
import { ProductionForm, type ProductionFormData } from '@/components/production-form';
import { SignoffPanel } from '@/components/signoff-panel';
import { slotViews } from '@/lib/sign';
import { canApprove, canUnlock } from '@/lib/constants';
import { canApproveNow } from '@/lib/approval';
import { adIso, formatMiti } from '@/lib/dates';
import { parsePacked } from '@/lib/calc';

export const dynamic = 'force-dynamic';

export default async function ProductionPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const r = await prisma.productionReport.findUnique({
    where: { id: params.id },
    include: {
      mill: true,
      batch: true,
      inputs: { orderBy: { sortOrder: 'asc' } },
      rows: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
      downtime: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!r) notFound();

  const [packSizes, intakes, slots, me] = await Promise.all([
    prisma.packSize.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, label: true } }),
    prisma.intakeReport.findMany({
      where: { OR: [{ millId: r.millId }, { millId: null }] },
      orderBy: { dateAd: 'desc' },
      take: 50,
      include: { material: true, supplier: true },
    }),
    slotViews('production', params.id),
    prisma.user.findUnique({ where: { id: user.id }, select: { signatureData: true } }),
  ]);

  const extras = r.processExtras ? JSON.parse(r.processExtras) : {};
  const initial: ProductionFormData = {
    id: r.id,
    status: r.status,
    millName: r.mill.name,
    processFields: r.mill.processFields ? JSON.parse(r.mill.processFields) : [],
    yieldLimits: {
      totalRecoveryMin: r.mill.totalRecoveryMin,
      totalRecoveryMax: r.mill.totalRecoveryMax,
      mainYieldMin: r.mill.mainYieldMin,
      mainYieldMax: r.mill.mainYieldMax,
    },
    header: {
      dateAd: adIso(r.dateAd),
      dateBs: r.dateBs,
      packagingHours: r.packagingHours?.toString() ?? '',
      vendors: r.vendors ?? '',
      manpower: r.manpower?.toString() ?? '',
      startTime: r.startTime ?? '',
      closeTime: r.closeTime ?? '',
      breakdownMin: r.breakdownMin?.toString() ?? '',
      breakdownOverridden: false,
      cumulativeMT: r.cumulativeMT?.toString() ?? '',
      electricityKwh: r.electricityKwh?.toString() ?? '',
      voltage: r.voltage?.toString() ?? '',
      cumulativeKwh: r.cumulativeKwh?.toString() ?? '',
      soakTimeHrs: extras.soakTimeHrs ?? '',
      roastTempC: extras.roastTempC ?? '',
      saltNotes: extras.saltNotes ?? '',
      preparedBy: r.preparedBy ?? '',
    },
    inputs: r.inputs.map((i) => ({
      invoiceNo: i.invoiceNo ?? '',
      kantaKg: i.kantaKg,
      boraKg: i.boraKg,
      bagType: i.bagType ?? '',
      intakeReportId: i.intakeReportId ?? '',
    })),
    rows: r.rows.map((row) => ({
      productId: row.productId,
      productName: row.product.name,
      kind: row.product.kind,
      semiFinishedKg: row.semiFinishedKg,
      packedKg: parsePacked(row.packedKg),
    })),
    downtime: r.downtime.map((d) => ({
      fromTime: d.fromTime ?? '',
      toTime: d.toTime ?? '',
      department: d.department ?? '',
      rootCause: d.rootCause ?? '',
    })),
  };

  return (
    <Shell user={user} active="/production">
      <PageTitle
        title={`Daily Production ${r.reportNo} — ${r.mill.name}`}
        subtitle={<>
          Batch <Link href={`/batches/${r.batchId}`} className="text-brand-700 hover:underline">{r.batch.batchNo}</Link>
          {' '}· {adIso(r.dateAd)} · Miti {formatMiti(r.dateBs)}
        </>}
      />
      <ProductionForm
        initial={initial}
        packSizes={packSizes}
        intakeOptions={intakes.map((i) => ({ id: i.id, label: `${i.reportNo} — ${i.material.name}${i.supplier ? ' · ' + i.supplier.name : ''} (${i.weightKg?.toLocaleString('en-IN') ?? '?'} kg)` }))}
        canApprove={canApprove(user.role)}
        canUnlock={canUnlock(user.role)}
      />
      <div className="mt-5">
        <SignoffPanel type="production" id={r.id} status={r.status} slots={slots} userHasSignature={Boolean(me?.signatureData)} canApprove={await canApproveNow('production', r.approvalStage, user.role)} />
      </div>
    </Shell>
  );
}
