// Weekly production report — Sunday–Saturday (Nepali working week), per mill:
// input vs output, recovery & main-product yield vs the mill's expected band,
// per-product totals and a day-by-day breakdown. Read-only rollup of the
// approved + submitted daily reports; prints as-is.
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle } from '@/components/ui';
import { adIso, addDays, adToBs, formatMiti, todayKathmandu } from '@/lib/dates';
import { parsePacked, rowTotalKg, round2, fmtKg, fmtPct, fmtMinutes } from '@/lib/calc';

export const dynamic = 'force-dynamic';

function weekStartOf(adIsoStr: string): string {
  const [y, m, d] = adIsoStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return adIso(new Date(y, m - 1, d - dt.getDay())); // getDay(): 0 = Sunday
}

export default async function WeeklyReport({ searchParams }: { searchParams: { start?: string } }) {
  const user = await requireUser();
  const start = weekStartOf(searchParams.start && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.start) ? searchParams.start : todayKathmandu());
  const end = addDays(start, 6); // inclusive Saturday
  const from = new Date(start + 'T00:00:00');
  const to = new Date(addDays(start, 7) + 'T00:00:00');

  const [mills, reports] = await Promise.all([
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.productionReport.findMany({
      where: { dateAd: { gte: from, lt: to }, status: { in: ['SUBMITTED', 'APPROVED'] } },
      include: {
        batch: true,
        inputs: true,
        rows: { include: { product: true } },
        downtime: true,
      },
      orderBy: { dateAd: 'asc' },
    }),
  ]);

  const byMill = mills.map((mill) => {
    const rs = reports.filter((r) => r.millId === mill.id);
    let netInput = 0, totalOutput = 0, mainOutput = 0, downtimeMin = 0, electricity = 0;
    const products = new Map<string, { name: string; kind: string; kg: number }>();
    const days = rs.map((r) => {
      const inp = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
      let out = 0;
      for (const row of r.rows) {
        const kg = rowTotalKg(row.semiFinishedKg, parsePacked(row.packedKg));
        out += kg;
        const p = products.get(row.productId) ?? { name: row.product.name, kind: row.product.kind, kg: 0 };
        p.kg += kg;
        products.set(row.productId, p);
        if (row.product.kind === 'PRODUCT') mainOutput += kg;
      }
      netInput += inp;
      totalOutput += out;
      downtimeMin += r.downtime.reduce((a, d) => a + (d.durationMin ?? 0), 0);
      electricity += r.electricityKwh ?? 0;
      return { r, inp, out, recovery: inp ? round2((out / inp) * 100) : null };
    });
    const recovery = netInput ? round2((totalOutput / netInput) * 100) : null;
    const mainYield = netInput ? round2((mainOutput / netInput) * 100) : null;
    return { mill, days, netInput, totalOutput, mainOutput, recovery, mainYield, downtimeMin, electricity, products: [...products.values()] };
  }).filter((m) => m.days.length > 0);

  const wk = (s: string) => `/reports/weekly?start=${s}`;

  return (
    <Shell user={user} active="/reports/weekly">
      <PageTitle
        title="Weekly Production Report"
        subtitle={<>
          {start} → {end} · Miti {formatMiti(adToBs(start))} → {formatMiti(adToBs(end))} · Sunday to Saturday ·
          counts submitted and approved daily reports
        </>}
      />
      <div className="no-print mb-4 flex items-center gap-2 text-sm">
        <Link className="btn-secondary" href={wk(addDays(start, -7))}>← previous week</Link>
        <Link className="btn-secondary" href={wk(todayKathmandu())}>this week</Link>
        <Link className="btn-secondary" href={wk(addDays(start, 7))}>next week →</Link>
      </div>

      {byMill.length === 0 && (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-stone-500">
          No production reports in this week yet. Daily reports appear here once they are submitted.
        </div>
      )}

      <div className="space-y-6">
        {byMill.map(({ mill, days, netInput, totalOutput, mainOutput, recovery, mainYield, downtimeMin, electricity, products }) => {
          const recTone = toneCls(recovery, mill.totalRecoveryMin, mill.totalRecoveryMax);
          const mainTone = toneCls(mainYield, mill.mainYieldMin, mill.mainYieldMax);
          return (
            <section key={mill.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="mb-3 text-base font-bold text-stone-800">{mill.name} <span className="font-normal text-stone-400">· {days.length} production day{days.length > 1 ? 's' : ''}</span></h2>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
                <Tile label="Raw material in" value={`${fmtKg(netInput)} kg`} />
                <Tile label="Total out" value={`${fmtKg(totalOutput)} kg`} />
                <Tile label="Total recovery" value={recovery !== null ? fmtPct(recovery) : '—'} cls={recTone}
                  sub={band(mill.totalRecoveryMin, mill.totalRecoveryMax)} />
                <Tile label="Main-product yield" value={mainYield !== null ? fmtPct(mainYield) : '—'} cls={mainTone}
                  sub={band(mill.mainYieldMin, mill.mainYieldMax)} />
                <Tile label="Downtime" value={fmtMinutes(downtimeMin) ?? '—'} />
                <Tile label="Electricity" value={electricity ? `${fmtKg(electricity)} kWh` : '—'} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Output by product</h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-stone-500">
                      <tr><th className="py-1">Product</th><th className="py-1 text-right">kg</th><th className="py-1 text-right">% of input</th></tr>
                    </thead>
                    <tbody>
                      {products.sort((a, b) => b.kg - a.kg).map((p) => (
                        <tr key={p.name} className={`border-t border-stone-100 ${p.kind === 'BYPRODUCT' ? 'text-stone-500' : ''}`}>
                          <td className="py-1">{p.name}{p.kind === 'BYPRODUCT' && <span className="ml-1 text-xs text-stone-400">(by-product)</span>}</td>
                          <td className="py-1 text-right tabular-nums">{fmtKg(p.kg)}</td>
                          <td className="py-1 text-right tabular-nums">{netInput && p.kg ? fmtPct(round2((p.kg / netInput) * 100)) : '—'}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-stone-300 font-semibold">
                        <td className="py-1">Main products together</td>
                        <td className="py-1 text-right tabular-nums">{fmtKg(mainOutput)}</td>
                        <td className="py-1 text-right tabular-nums">{mainYield !== null ? fmtPct(mainYield) : '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Day by day</h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-stone-500">
                      <tr><th className="py-1">Date</th><th className="py-1">Batch</th><th className="py-1 text-right">In (kg)</th><th className="py-1 text-right">Out (kg)</th><th className="py-1 text-right">Recovery</th></tr>
                    </thead>
                    <tbody>
                      {days.map(({ r, inp, out, recovery: rec }) => (
                        <tr key={r.id} className="border-t border-stone-100">
                          <td className="py-1">
                            <Link href={`/production/${r.id}`} className="text-brand-700 hover:underline">{adIso(r.dateAd)}</Link>
                            <span className="ml-1 text-xs text-stone-400">({formatMiti(r.dateBs)})</span>
                          </td>
                          <td className="py-1">{r.batch.batchNo}</td>
                          <td className="py-1 text-right tabular-nums">{fmtKg(inp)}</td>
                          <td className="py-1 text-right tabular-nums">{fmtKg(out)}</td>
                          <td className="py-1 text-right tabular-nums">{rec !== null ? fmtPct(rec) : '—'}</td>
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
