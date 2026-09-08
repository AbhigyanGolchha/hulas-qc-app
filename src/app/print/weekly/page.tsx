// Paper-style weekly production report. Browser Print → Save as PDF.
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PrintButton } from '@/components/print-button';
import { PrintHeader, td, th } from '@/components/print-bits';
import { adToBs, formatAdLong, formatMiti, fmtNpt } from '@/lib/dates';
import { fmtKg, fmtMinutes, fmtPct } from '@/lib/calc';
import { buildWeekly, resolveWeekStart } from '@/lib/weekly';

export const dynamic = 'force-dynamic';

export default async function PrintWeekly({ searchParams }: { searchParams: { start?: string } }) {
  const user = await requireUser();
  const start = resolveWeekStart(searchParams.start);
  const { end, mills } = await buildWeekly(start);
  const company = (await prisma.setting.findUnique({ where: { key: 'company.name' } }))?.value ?? 'Hulas Khadya Udyog Pvt. Ltd.';

  return (
    <>
      <PrintButton />
      <PrintHeader companyName={company} title="Weekly Production Report" sub={`${formatAdLong(start)} to ${formatAdLong(end)} · Miti ${formatMiti(adToBs(start))} to ${formatMiti(adToBs(end))} (Sunday–Saturday)`} />

      {mills.length === 0 && <p className="text-xs">No submitted or approved daily production reports in this week.</p>}

      {mills.length > 1 && (
        <>
          <div className="mb-1 text-xs font-bold uppercase">All mills — summary</div>
          <table className="mb-4 w-full border-collapse text-xs">
            <thead>
              <tr><th className={th}>Mill</th><th className={th}>Days</th><th className={th}>In (kg)</th><th className={th}>Out (kg)</th><th className={th}>Main (kg)</th><th className={th}>Recovery</th><th className={th}>Main yield</th><th className={th}>Downtime</th><th className={th}>Efficiency</th><th className={th}>kWh</th></tr>
            </thead>
            <tbody>
              {mills.map((m) => (
                <tr key={m.millId}>
                  <td className={td}>{m.millName}</td>
                  <td className={td}>{m.days.length}</td>
                  <td className={td}>{fmtKg(m.netInput)}</td>
                  <td className={td}>{fmtKg(m.totalOutput)}</td>
                  <td className={td}>{fmtKg(m.mainOutput)}</td>
                  <td className={td}>{m.recoveryPct !== null ? fmtPct(m.recoveryPct) : ''}</td>
                  <td className={td}>{m.mainYieldPct !== null ? fmtPct(m.mainYieldPct) : ''}</td>
                  <td className={td}>{fmtMinutes(m.downtimeMin)}</td>
                  <td className={td}>{m.efficiencyPct !== null ? fmtPct(m.efficiencyPct) : ''}</td>
                  <td className={td}>{m.electricityKwh ? fmtKg(m.electricityKwh) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {mills.map((m) => (
        <div key={m.millId} className="mb-5 break-inside-avoid">
          <div className="mb-1 border-b border-black text-sm font-bold">{m.millName} <span className="font-normal">· {m.days.length} production day{m.days.length > 1 ? 's' : ''}</span></div>
          <table className="mb-2 w-full border-collapse text-xs">
            <tbody>
              <tr>
                <td className={td}>Raw material in: <b>{fmtKg(m.netInput)} kg</b></td>
                <td className={td}>Total out: <b>{fmtKg(m.totalOutput)} kg</b></td>
                <td className={td}>Total recovery: <b>{m.recoveryPct !== null ? fmtPct(m.recoveryPct) : '—'}</b> <span className="text-stone-500">{bandTxt(m.limits.totalRecoveryMin, m.limits.totalRecoveryMax)}</span></td>
                <td className={td}>Main-product yield: <b>{m.mainYieldPct !== null ? fmtPct(m.mainYieldPct) : '—'}</b> <span className="text-stone-500">{bandTxt(m.limits.mainYieldMin, m.limits.mainYieldMax)}</span></td>
              </tr>
              <tr>
                <td className={td}>Shift time: <b>{fmtMinutes(m.shiftMin)}</b></td>
                <td className={td}>Downtime: <b>{fmtMinutes(m.downtimeMin)}</b></td>
                <td className={td}>Efficiency: <b>{m.efficiencyPct !== null ? fmtPct(m.efficiencyPct) : '—'}</b></td>
                <td className={td}>Electricity: <b>{m.electricityKwh ? `${fmtKg(m.electricityKwh)} kWh` : '—'}</b></td>
              </tr>
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-3">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr><th className={th}>Product</th><th className={th}>kg</th><th className={th}>% of input</th></tr>
              </thead>
              <tbody>
                {m.products.map((p) => (
                  <tr key={p.productId}>
                    <td className={td}>{p.name}{p.kind === 'BYPRODUCT' ? ' (by-product)' : ''}</td>
                    <td className={td}>{fmtKg(p.kg)}</td>
                    <td className={td}>{p.pctOfInput !== null ? fmtPct(p.pctOfInput) : ''}</td>
                  </tr>
                ))}
                <tr><td className={`${td} font-bold`}>Main products together</td><td className={`${td} font-bold`}>{fmtKg(m.mainOutput)}</td><td className={`${td} font-bold`}>{m.mainYieldPct !== null ? fmtPct(m.mainYieldPct) : ''}</td></tr>
                <tr><td className={`${td} font-bold`}>All output</td><td className={`${td} font-bold`}>{fmtKg(m.totalOutput)}</td><td className={`${td} font-bold`}>{m.recoveryPct !== null ? fmtPct(m.recoveryPct) : ''}</td></tr>
              </tbody>
            </table>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr><th className={th}>Date</th><th className={th}>Batch</th><th className={th}>In (kg)</th><th className={th}>Out (kg)</th><th className={th}>Recovery</th><th className={th}>Effic.</th></tr>
              </thead>
              <tbody>
                {m.days.map((d) => (
                  <tr key={d.id}>
                    <td className={td}>{d.dateAd}<br /><span className="text-stone-500">Miti {formatMiti(d.dateBs)}</span></td>
                    <td className={td}>{d.batchNo}<br /><span className="text-stone-500">{d.reportNo}</span></td>
                    <td className={td}>{fmtKg(d.inputKg)}</td>
                    <td className={td}>{fmtKg(d.outputKg)}</td>
                    <td className={td}>{d.recoveryPct !== null ? fmtPct(d.recoveryPct) : ''}</td>
                    <td className={td}>{d.efficiencyPct !== null ? fmtPct(d.efficiencyPct, 0) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <p className="mt-4 text-[10px] text-stone-500">
        Generated {fmtNpt(new Date())} by {user.name}. Counts submitted and approved daily production reports only.
        Total recovery = all output ÷ net raw-material input; main-product yield excludes by-products; efficiency = (shift − downtime) ÷ shift.
      </p>
    </>
  );
}

function bandTxt(min: number | null, max: number | null): string {
  if (min === null && max === null) return '';
  return `(expected ${min ?? '…'}–${max ?? '…'}%)`;
}
