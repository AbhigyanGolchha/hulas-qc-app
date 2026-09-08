// Weekly production report — Sunday–Saturday (Nepali working week), per mill:
// input vs output, recovery & main-product yield vs the mill's expected band,
// per-product totals and a day-by-day breakdown. Read-only rollup of the
// approved + submitted daily reports. Export: CSV (download) or PDF (print view).
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle } from '@/components/ui';
import { addDays, adToBs, formatMiti, todayKathmandu } from '@/lib/dates';
import { fmtKg, fmtPct, fmtMinutes } from '@/lib/calc';
import { buildWeekly, resolveWeekStart } from '@/lib/weekly';

export const dynamic = 'force-dynamic';

export default async function WeeklyReport({ searchParams }: { searchParams: { start?: string } }) {
  const user = await requireUser();
  const start = resolveWeekStart(searchParams.start);
  const { end, mills } = await buildWeekly(start);
  const wk = (s: string) => `/reports/weekly?start=${s}`;

  return (
    <Shell user={user} active="/reports/weekly">
      <PageTitle
        title="Weekly Production Report"
        subtitle={<>
          {start} → {end} · Miti {formatMiti(adToBs(start))} → {formatMiti(adToBs(end))} · Sunday to Saturday ·
          counts submitted and approved daily reports
        </>}
      >
        <a className="btn-secondary" href={`/api/csv?type=weekly&start=${start}`}>Export CSV</a>
        <a className="btn-secondary" href={`/print/weekly?start=${start}`} target="_blank">Export PDF / Print</a>
      </PageTitle>
      <div className="no-print mb-4 flex items-center gap-2 text-sm">
        <Link className="btn-secondary" href={wk(addDays(start, -7))}>← previous week</Link>
        <Link className="btn-secondary" href={wk(todayKathmandu())}>this week</Link>
        <Link className="btn-secondary" href={wk(addDays(start, 7))}>next week →</Link>
      </div>

      {mills.length === 0 && (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-stone-500">
          No production reports in this week yet. Daily reports appear here once they are submitted.
        </div>
      )}

      <div className="space-y-6">
        {mills.map((m) => {
          const recTone = toneCls(m.recoveryPct, m.limits.totalRecoveryMin, m.limits.totalRecoveryMax);
          const mainTone = toneCls(m.mainYieldPct, m.limits.mainYieldMin, m.limits.mainYieldMax);
          return (
            <section key={m.millId} className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="mb-3 text-base font-bold text-stone-800">{m.millName} <span className="font-normal text-stone-400">· {m.days.length} production day{m.days.length > 1 ? 's' : ''}</span></h2>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-7">
                <Tile label="Raw material in" value={`${fmtKg(m.netInput)} kg`} />
                <Tile label="Total out" value={`${fmtKg(m.totalOutput)} kg`} />
                <Tile label="Total recovery" value={m.recoveryPct !== null ? fmtPct(m.recoveryPct) : '—'} cls={recTone}
                  sub={band(m.limits.totalRecoveryMin, m.limits.totalRecoveryMax)} />
                <Tile label="Main-product yield" value={m.mainYieldPct !== null ? fmtPct(m.mainYieldPct) : '—'} cls={mainTone}
                  sub={band(m.limits.mainYieldMin, m.limits.mainYieldMax)} />
                <Tile label="Downtime" value={fmtMinutes(m.downtimeMin)} sub={m.shiftMin ? `of ${fmtMinutes(m.shiftMin)} shift` : undefined} />
                <Tile label="Efficiency" value={m.efficiencyPct !== null ? fmtPct(m.efficiencyPct) : '—'} sub="production ÷ shift time" />
                <Tile label="Electricity" value={m.electricityKwh ? `${fmtKg(m.electricityKwh)} kWh` : '—'} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Output by product</h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-stone-500">
                      <tr><th className="py-1">Product</th><th className="py-1 text-right">kg</th><th className="py-1 text-right">% of input</th></tr>
                    </thead>
                    <tbody>
                      {m.products.map((p) => (
                        <tr key={p.productId} className={`border-t border-stone-100 ${p.kind === 'BYPRODUCT' ? 'text-stone-500' : ''}`}>
                          <td className="py-1">{p.name}{p.kind === 'BYPRODUCT' && <span className="ml-1 text-xs text-stone-400">(by-product)</span>}</td>
                          <td className="py-1 text-right tabular-nums">{fmtKg(p.kg)}</td>
                          <td className="py-1 text-right tabular-nums">{p.pctOfInput !== null ? fmtPct(p.pctOfInput) : '—'}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-stone-300 font-semibold">
                        <td className="py-1">Main products together</td>
                        <td className="py-1 text-right tabular-nums">{fmtKg(m.mainOutput)}</td>
                        <td className="py-1 text-right tabular-nums">{m.mainYieldPct !== null ? fmtPct(m.mainYieldPct) : '—'}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="py-1">All output</td>
                        <td className="py-1 text-right tabular-nums">{fmtKg(m.totalOutput)}</td>
                        <td className="py-1 text-right tabular-nums">{m.recoveryPct !== null ? fmtPct(m.recoveryPct) : '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Day by day</h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-stone-500">
                      <tr><th className="py-1">Date</th><th className="py-1">Batch</th><th className="py-1 text-right">In (kg)</th><th className="py-1 text-right">Out (kg)</th><th className="py-1 text-right">Recovery</th><th className="py-1 text-right">Effic.</th></tr>
                    </thead>
                    <tbody>
                      {m.days.map((d) => (
                        <tr key={d.id} className="border-t border-stone-100">
                          <td className="py-1">
                            <Link href={`/production/${d.id}`} className="text-brand-700 hover:underline">{d.dateAd}</Link>
                            <span className="ml-1 text-xs text-stone-400">({formatMiti(d.dateBs)})</span>
                          </td>
                          <td className="py-1">{d.batchNo}</td>
                          <td className="py-1 text-right tabular-nums">{fmtKg(d.inputKg)}</td>
                          <td className="py-1 text-right tabular-nums">{fmtKg(d.outputKg)}</td>
                          <td className="py-1 text-right tabular-nums">{d.recoveryPct !== null ? fmtPct(d.recoveryPct) : '—'}</td>
                          <td className="py-1 text-right tabular-nums">{d.efficiencyPct !== null ? fmtPct(d.efficiencyPct, 0) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function band(min: number | null, max: number | null): string | undefined {
  if (min === null && max === null) return undefined;
  return `expected ${min ?? '…'}–${max ?? '…'}%`;
}
function toneCls(v: number | null, min: number | null, max: number | null): string {
  if (v === null || (min === null && max === null)) return '';
  if ((min !== null && v < min) || (max !== null && v > max)) return 'border-amber-300 bg-amber-50 text-amber-800';
  return 'border-green-300 bg-green-50 text-green-800';
}
function Tile({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls || 'border-stone-200 bg-stone-50 text-stone-800'}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs opacity-70">{sub}</div>}
    </div>
  );
}
