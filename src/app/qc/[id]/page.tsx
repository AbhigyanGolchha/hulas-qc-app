import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle } from '@/components/ui';
import { QcForm, type QcFormData } from '@/components/qc-form';
import { SignoffPanel } from '@/components/signoff-panel';
import { slotViews } from '@/lib/sign';
import { canApprove, canUnlock } from '@/lib/constants';
import { canApproveNow } from '@/lib/approval';
import { adIso, formatMiti } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export default async function QcPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const r = await prisma.qcReport.findUnique({
    where: { id: params.id },
    include: {
      batch: { include: { mill: true } },
      product: true,
      results: { include: { parameter: true, specVersion: true }, orderBy: { parameter: { sortOrder: 'asc' } } },
    },
  });
  if (!r) notFound();

  // sibling QC sheets on the same batch = "tabs per product"
  const [siblings, slots, me] = await Promise.all([
    prisma.qcReport.findMany({
      where: { batchId: r.batchId },
      include: { product: true },
      orderBy: { product: { sortOrder: 'asc' } },
    }),
    slotViews('qc', params.id),
    prisma.user.findUnique({ where: { id: user.id }, select: { signatureData: true } }),
  ]);

  const initial: QcFormData = {
    id: r.id,
    status: r.status,
    hasFortification: r.product.hasFortification,
    header: {
      dateAd: adIso(r.dateAd),
      dateBs: r.dateBs,
      analyst: r.analyst ?? '',
      overallResult: r.overallResult ?? '',
      overallOverridden: r.overallOverridden,
      overrideReason: r.overrideReason ?? '',
      remarks: r.remarks ?? '',
      premixBrand: r.premixBrand ?? '',
      premixLot: r.premixLot ?? '',
      premixTarget: r.premixTarget?.toString() ?? '',
      premixActual: r.premixActual?.toString() ?? '',
      doserWorking: r.doserWorking === true ? 'yes' : r.doserWorking === false ? 'no' : '',
      premixRemarks: r.premixRemarks ?? '',
      checkedBy: r.checkedBy ?? '',
    },
    rows: r.results.map((res) => ({
      parameterId: res.parameterId,
      name: res.parameter.name,
      unit: res.parameter.unit,
      valueType: res.parameter.valueType,
      options: res.parameter.options ? JSON.parse(res.parameter.options) : null,
      sampleCount: res.parameter.sampleCount,
      hasIr: res.parameter.hasIr,
      spec: {
        operator: res.specVersion.operator,
        min: res.specVersion.min,
        max: res.specVersion.max,
        textExpected: res.specVersion.textExpected,
        displayText: res.specVersion.displayText,
        sourceTag: res.specVersion.sourceTag,
      },
      sample1: res.sample1, sample2: res.sample2, sample3: res.sample3,
      irMoisture: res.irMoisture,
      resultNum: res.resultNum, resultText: res.resultText,
      resultOverridden: res.resultOverridden,
      remarks: res.remarks,
    })),
  };

  return (
    <Shell user={user} active="/qc">
      <PageTitle
        title={`${r.product.name} — ${r.reportNo}`}
        subtitle={<>
          Hulas Khadya Udyog · {r.batch.mill.name} · Batch{' '}
          <Link href={`/batches/${r.batchId}`} className="text-brand-700 hover:underline">{r.batch.batchNo}</Link>
          {' '}· {adIso(r.dateAd)} · Miti {formatMiti(r.dateBs)}
        </>}
      />
      {siblings.length > 1 && (
        <div className="no-print mb-4 flex flex-wrap gap-1 border-b border-stone-200 pb-2 text-sm">
          {siblings.map((s) => (
            <Link key={s.id} href={`/qc/${s.id}`}
              className={`rounded-t px-3 py-1.5 ${s.id === r.id ? 'bg-brand-50 font-semibold text-brand-700' : 'text-stone-600 hover:bg-stone-100'}`}>
              {s.product.name}
            </Link>
          ))}
          <Link href={`/qc/new?batch=${r.batchId}`} className="rounded-t px-3 py-1.5 text-stone-400 hover:bg-stone-100">+ add product</Link>
        </div>
      )}
      <QcForm initial={initial} canApprove={canApprove(user.role)} canUnlock={canUnlock(user.role)} isManager={canApprove(user.role)} />
      <div className="mt-5">
        <SignoffPanel type="qc" id={r.id} status={r.status} slots={slots} userHasSignature={Boolean(me?.signatureData)} canApprove={await canApproveNow('qc', r.approvalStage, user.role)} />
      </div>
    </Shell>
  );
}
