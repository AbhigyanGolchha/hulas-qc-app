import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PrintButton } from '@/components/print-button';
import { PrintHeader, PrintDates, SignRow, td, th } from '@/components/print-bits';
import { fmtKg, fmtMinutes, fmtPct, parsePacked, rowTotalKg, round2, shiftMinutes, efficiencyPct } from '@/lib/calc';

export const dynamic = 'force-dynamic';

export default async function PrintProduction({ params }: { params: { id: string } }) {
  await requireUser();
  const r = await prisma.productionReport.findUnique({
    where: { id: params.id },
    include: {
      mill: true,
      batch: true,
      inputs: { include: { intakeReport: true }, orderBy: { sortOrder: 'asc' } },
      rows: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
      downtime: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!r) notFound();
  const packSizes = await prisma.packSize.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  const company = (await prisma.setting.findUnique({ where: { key: 'company.name' } }))?.value ?? 'Hulas Khadya Udyog Pvt. Ltd.';

  const netInput = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
  const shiftMin = shiftMinutes(r.startTime, r.closeTime);
  const eff = efficiencyPct(shiftMin, r.breakdownMin ?? 0);
  const totals = r.rows.map((row) => rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg)));
  const totalOutput = totals.reduce((a, b) => a + b, 0);
  const mainOutput = r.rows.filter((x) => x.product.kind === 'PRODUCT').reduce((a, x) => a + rowTotalKg(x.semiFinishedKg, parsePacked(x.packedKg)), 0);
  const extras = r.processExtras ? JSON.parse(r.processExtras) : null;

  return (
    <>
      <PrintButton />
      <PrintHeader companyName={company} title={`${r.mill.name} — Daily Production Report`} sub={`Report No. ${r.reportNo} · Batch ${r.batch.batchNo}`} />
      <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs">
        <PrintDates ad={r.dateAd} bs={r.dateBs} />
        <span>Packaging time: <b>{r.packagingHours ?? '—'} hrs</b></span>
        <span>Vendors: <b>{r.vendors ?? '—'}</b></span>
      </div>

      <div className="mb-1 mt-2 text-xs font-bold uppercase">A · Raw material input</div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr><th className={th}>Invoice No.</th><th className={th}>Kanta Wt (kg)</th><th className={th}>Bora Wt (kg)</th><th className={th}>Net Input (kg)</th><th className={th}>Bag</th><th className={th}>Intake lot</th></tr>
        </thead>
        <tbody>
          {r.inputs.map((i) => (
            <tr key={i.id}>
              <td className={td}>{i.invoiceNo ?? ''}</td>
              <td className={td}>{fmtKg(i.kantaKg)}</td>
              <td className={td}>{fmtKg(i.boraKg)}</td>
              <td className={`${td} font-medium`}>{fmtKg(i.netKg)}</td>
              <td className={td}>{i.bagType ?? ''}</td>
              <td className={td}>{i.intakeReport?.reportNo ?? ''}</td>
            </tr>
          ))}
          <tr><td className={`${td} font-bold`}>Total</td><td className={td}></td><td className={td}></td><td className={`${td} font-bold`}>{fmtKg(netInput)}</td><td className={td} colSpan={2}></td></tr>
        </tbody>
      </table>

      <div className="mb-1 mt-3 text-xs font-bold uppercase">B · Shift & operations</div>
      <table className="w-full border-collapse text-xs">
        <tbody>
          <tr>
            <td className={td}>Man Power: <b>{r.manpower ?? '—'}</b></td>
            <td className={td}>Time: <b>{r.startTime ?? '—'} – {r.closeTime ?? '—'}</b> ({fmtMinutes(shiftMin)})</td>
            <td className={td}>Breakdown: <b>{fmtMinutes(r.breakdownMin ?? 0)}</b></td>
            <td className={td}>Production time: <b>{fmtMinutes(shiftMin !== null ? shiftMin - (r.breakdownMin ?? 0) : null)}</b></td>
          </tr>
          <tr>
            <td className={td}>Efficiency: <b>{eff !== null ? `${eff}%` : '—'}</b></td>
            <td className={td}>Cumulative production: <b>{r.cumulativeMT ?? '—'} MT</b></td>
            <td className={td}>Electricity: <b>{r.electricityKwh ?? '—'} kWh</b> @ {r.voltage ?? '—'} V</td>
            <td className={td}>Cumulative: <b>{r.cumulativeKwh ?? '—'} kWh</b></td>
          </tr>
          {extras && (
            <tr>
              <td className={td} colSpan={4}>
                {extras.soakTimeHrs && <>Soak time: <b>{extras.soakTimeHrs} hrs</b> · </>}
                {extras.roastTempC && <>Roasting/puffing temp: <b>{extras.roastTempC} °C</b> · </>}
                {extras.saltNotes && <>Salt conditioning: <b>{extras.saltNotes}</b></>}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mb-1 mt-3 text-xs font-bold uppercase">C · Production details</div>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className={th}>Product</th>
            <th className={th}>Semi-fin. (kg)</th>
            {packSizes.map((p) => <th key={p.id} className={th}>{p.label}</th>)}
            <th className={th}>Total (kg)</th>
            <th className={th}>%</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, i) => {
            const packed = parsePacked(row.packedKg);
            return (
              <tr key={row.id}>
                <td className={td}>{row.product.name}</td>
                <td className={td}>{row.semiFinishedKg ? fmtKg(row.semiFinishedKg) : ''}</td>
                {packSizes.map((p) => <td key={p.id} className={td}>{packed[p.id] ? fmtKg(packed[p.id]) : ''}</td>)}
                <td className={`${td} font-medium`}>{totals[i] ? fmtKg(totals[i]) : ''}</td>
                <td className={td}>{netInput && totals[i] ? fmtPct(round2((totals[i] / netInput) * 100)) : ''}</td>
              </tr>
            );
          })}
          <tr>
            <td className={`${td} font-bold`}>Total output</td>
            <td className={td} colSpan={packSizes.length + 1}></td>
            <td className={`${td} font-bold`}>{fmtKg(totalOutput)}</td>
            <td className={`${td} font-bold`}>{netInput ? fmtPct(round2((totalOutput / netInput) * 100)) : ''}</td>
          </tr>
          <tr>
            <td className={`${td} font-bold`}>Actual yield (main products)</td>
            <td className={td} colSpan={packSizes.length + 1}></td>
            <td className={`${td} font-bold`}>{fmtKg(mainOutput)}</td>
            <td className={`${td} font-bold`}>{netInput ? fmtPct(round2((mainOutput / netInput) * 100)) : ''}</td>
          </tr>
        </tbody>
      </table>

      {r.downtime.length > 0 && (
        <>
          <div className="mb-1 mt-3 text-xs font-bold uppercase">D · Downtime log</div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr><th className={th}>S.No</th><th className={th}>From</th><th className={th}>To</th><th className={th}>Duration</th><th className={th}>Department</th><th className={th}>Root cause of delay</th></tr>
            </thead>
            <tbody>
              {r.downtime.map((d, i) => (
                <tr key={d.id}>
                  <td className={td}>{i + 1}</td>
                  <td className={td}>{d.fromTime ?? ''}</td>
                  <td className={td}>{d.toTime ?? ''}</td>
                  <td className={td}>{fmtMinutes(d.durationMin)}</td>
                  <td className={td}>{d.department ?? ''}</td>
                  <td className={td}>{d.rootCause ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <SignRow
        signs={[
          { label: 'Prepared By', name: r.preparedBy },
          { label: 'Approved By', name: r.approvedBy, at: r.approvedAt },
        ]}
      />
    </>
  );
}
