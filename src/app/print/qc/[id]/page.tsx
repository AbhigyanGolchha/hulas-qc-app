import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PrintButton } from '@/components/print-button';
import { PrintHeader, PrintDates, SignRow, toPrintSigns, td, th } from '@/components/print-bits';
import { getSignatures } from '@/lib/sign';

export const dynamic = 'force-dynamic';

export default async function PrintQc({ params }: { params: { id: string } }) {
  await requireUser();
  const r = await prisma.qcReport.findUnique({
    where: { id: params.id },
    include: {
      batch: { include: { mill: true } },
      product: true,
      results: { include: { parameter: true, specVersion: true }, orderBy: { parameter: { sortOrder: 'asc' } } },
    },
  });
  if (!r) notFound();
  const company = (await prisma.setting.findUnique({ where: { key: 'company.name' } }))?.value ?? 'Hulas Khadya Udyog Pvt. Ltd.';

  return (
    <>
      <PrintButton />
      <PrintHeader companyName={company} title={`Quality Control Report — ${r.product.name}`} sub={`${r.batch.mill.name} · Report No. ${r.reportNo}`} />
      <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs">
        <PrintDates ad={r.dateAd} bs={r.dateBs} />
        <span>Batch No.: <b>{r.batch.batchNo}</b></span>
        <span>Analyst: <b>{r.analyst ?? '—'}</b></span>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className={th}>Parameter Checked</th>
            <th className={th}>Standard Specification</th>
            <th className={th}>1st Sample</th>
            <th className={th}>2nd Sample</th>
            <th className={th}>3rd Sample</th>
            <th className={th}>IR Moisture</th>
            <th className={th}>Result Obtained</th>
            <th className={th}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {r.results.map((res) => (
            <tr key={res.id}>
              <td className={td}>{res.parameter.name}{res.parameter.unit ? ` (${res.parameter.unit})` : ''}</td>
              <td className={td}>{res.specVersion.displayText}</td>
              <td className={td}>{res.sample1 ?? ''}</td>
              <td className={td}>{res.sample2 ?? ''}</td>
              <td className={td}>{res.sample3 ?? ''}</td>
              <td className={td}>{res.irMoisture ?? ''}</td>
              <td className={`${td} font-medium`}>
                {res.resultNum !== null ? res.resultNum : res.resultText ?? ''}
                {res.evalStatus === 'FAIL' ? ' ✗' : ''}
              </td>
              <td className={td}>{res.remarks ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.product.hasFortification && (
        <div className="mt-3 border border-black p-2 text-xs">
          <b>Fortification check:</b> Premix {r.premixBrand ?? '—'} (lot {r.premixLot ?? '—'}) ·
          dosing target {r.premixTarget ?? '—'} g/MT, actual {r.premixActual ?? '—'} g/MT ·
          doser {r.doserWorking === true ? 'working' : r.doserWorking === false ? 'NOT working' : '—'}
          {r.premixRemarks && <> · {r.premixRemarks}</>}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border border-black p-2 text-xs">
        <span>
          <b>Overall Result:</b>{' '}
          <span className="text-base font-bold">{r.overallResult ?? 'PENDING'}</span>
          {r.overallOverridden && <> (manager override: {r.overrideReason})</>}
        </span>
        <span><b>Remarks:</b> {r.remarks ?? '—'}</span>
      </div>

      <SignRow
        signs={toPrintSigns(
          [
            { slot: 'Checked by', legacyName: r.checkedBy },
            { slot: 'Approved by (GM)', legacyName: r.approvedBy, legacyAt: r.approvedAt },
          ],
          await getSignatures('qc', r.id),
        )}
      />
      <p className="mt-4 text-[10px] text-stone-500">
        Specs shown are the versions in force when this batch was tested.
      </p>
    </>
  );
}
