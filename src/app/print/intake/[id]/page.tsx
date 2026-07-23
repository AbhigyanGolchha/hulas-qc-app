import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PrintButton } from '@/components/print-button';
import { PrintHeader, PrintDates, SignRow, td, th } from '@/components/print-bits';
import { DECISIONS, type Decision } from '@/lib/constants';
import { intakeValue, fmtMoney, fmtKg } from '@/lib/calc';

export const dynamic = 'force-dynamic';

export default async function PrintIntake({ params }: { params: { id: string } }) {
  await requireUser();
  const r = await prisma.intakeReport.findUnique({
    where: { id: params.id },
    include: {
      material: true, supplier: true, mill: true,
      results: { include: { parameter: true, specVersion: true }, orderBy: { parameter: { sortOrder: 'asc' } } },
    },
  });
  if (!r) notFound();
  const company = (await prisma.setting.findUnique({ where: { key: 'company.name' } }))?.value ?? 'Hulas Khadya Udyog Pvt. Ltd.';

  return (
    <>
      <PrintButton />
      <PrintHeader companyName={company} title={`Spot Analysis Report — ${r.material.name}`} sub={`Report No. ${r.reportNo}`} />
      <div className="mb-2 flex justify-between text-xs">
        <PrintDates ad={r.dateAd} bs={r.dateBs} />
        <span>Destination mill: <b>{r.mill?.name ?? '—'}</b></span>
      </div>
      <table className="mb-3 w-full border-collapse text-xs">
        <tbody>
          <tr>
            <td className={td}>Party name: <b>{r.supplier?.name ?? '—'}</b></td>
            <td className={td}>Variety: <b>{r.variety ?? '—'}</b></td>
            <td className={td}>Season: <b>{r.season ?? '—'}</b></td>
          </tr>
          <tr>
            <td className={td}>Challan No.: <b>{r.challanNo ?? '—'}</b></td>
            <td className={td}>Vehicle No.: <b>{r.vehicleNo ?? '—'}</b></td>
            <td className={td}>Unloading: <b>{r.unloadingPlace ?? '—'}</b></td>
          </tr>
          <tr>
            <td className={td} colSpan={3}>
              Weight: <b>{r.weightKg?.toLocaleString('en-IN') ?? '—'} kg</b>
              {r.bags ? <> ({r.bags} bags{r.bagType ? `, ${r.bagType}` : ''})</> : null}
            </td>
          </tr>
        </tbody>
      </table>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className={th}>S.N.</th>
            <th className={th}>Parameter</th>
            <th className={th}>Standard Specification</th>
            <th className={th}>Result</th>
            <th className={th}>Remark</th>
          </tr>
        </thead>
        <tbody>
          {r.results.map((res, i) => (
            <tr key={res.id}>
              <td className={td}>{i + 1}</td>
              <td className={td}>{res.parameter.name}</td>
              <td className={td}>{res.specVersion.displayText}</td>
              <td className={`${td} font-medium`}>
                {res.valueNum !== null ? `${res.valueNum}${res.parameter.unit ? ' ' + res.parameter.unit : ''}` : res.valueText ?? ''}
              </td>
              <td className={td}>{res.evalStatus === 'FAIL' ? 'Out of spec' : res.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 border border-black p-2 text-xs">
        <b>Decision:</b> {r.decision ? DECISIONS[r.decision as Decision] : 'Pending'}
        {r.decisionReason && <> — {r.decisionReason}</>}
        {r.deductionRate != null && <> · Rate (legacy): {r.deductionRate}</>}
      </div>

      {r.pricePerQuintal != null && (() => {
        const v = intakeValue({
          weightKg: r.weightKg, pricePerQuintal: r.pricePerQuintal,
          weightCutKg: r.weightCutKg, priceCutPerQuintal: r.priceCutPerQuintal, flatDeduction: r.deductionAmount,
        });
        return (
          <table className="mt-2 w-full border-collapse text-xs">
            <tbody>
              <tr>
                <td className={td}>Rate: <b>{fmtMoney(r.pricePerQuintal)}/quintal</b></td>
                <td className={td}>Lot value: <b>{fmtMoney(v.grossValue)}</b></td>
                <td className={td}>
                  Deductions: <b>{fmtMoney(v.totalDeduction)}</b>
                  {(r.weightCutKg || r.priceCutPerQuintal || r.deductionAmount) ? (
                    <> ({[
                      r.weightCutKg ? `weight cut ${fmtKg(r.weightCutKg)} kg` : null,
                      r.priceCutPerQuintal ? `price cut ${fmtMoney(r.priceCutPerQuintal)}/qtl` : null,
                      r.deductionAmount ? `flat ${fmtMoney(r.deductionAmount)}` : null,
                    ].filter(Boolean).join(', ')})</>
                  ) : null}
                </td>
              </tr>
              <tr>
                <td className={td}>Payable weight: <b>{fmtKg(v.payableWeightKg)} kg</b></td>
                <td className={td}>Amount payable: <b>{fmtMoney(v.payableValue)}</b></td>
                <td className={td}>Effective rate: <b>{fmtMoney(v.effectiveRatePerQuintal)}/quintal</b></td>
              </tr>
            </tbody>
          </table>
        );
      })()}

      <SignRow
        signs={[
          { label: 'Sig. of Godown Keeper', name: r.godownKeeper },
          { label: 'Sig. of Quality Controller', name: r.checkedBy },
          { label: 'Sig. of Manager', name: r.approvedBy, at: r.approvedAt },
        ]}
      />
    </>
  );
}
