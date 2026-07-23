import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PassFailBadge, DualDate } from '@/components/ui';
import { LineChart, ParetoBars, StatTile } from '@/components/charts';
import { canApprove } from '@/lib/constants';
import { logAudit } from '@/lib/audit';
import { exportToOutbox } from '@/lib/sap';
import { adIso, todayKathmandu, addDays } from '@/lib/dates';
import { parsePacked, rowTotalKg, round2, shiftMinutes, efficiencyPct } from '@/lib/calc';

export const dynamic = 'force-dynamic';

async function quickApprove(formData: FormData) {
  'use server';
  const user = await requireUser();
  if (!canApprove(user.role)) return;
  const type = String(formData.get('type')) as 'intake' | 'qc' | 'production';
  const id = String(formData.get('id'));
  const model = type === 'intake' ? prisma.intakeReport : type === 'qc' ? prisma.qcReport : prisma.productionReport;
  // @ts-expect-error dynamic model union
  const rec = await model.findUnique({ where: { id } });
  if (!rec || rec.status !== 'SUBMITTED') return;
  // @ts-expect-error dynamic model union
  await model.update({ where: { id }, data: { status: 'APPROVED', approvedBy: user.name, approvedAt: new Date() } });
  await logAudit(user, type.toUpperCase(), id, 'APPROVE');
  await exportToOutbox(type === 'intake' ? 'INTAKE' : type === 'qc' ? 'QC' : 'PRODUCTION', id);
  revalidatePath('/');
}

export default async function Home({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await requireUser();
  const today = todayKathmandu();
  const from = searchParams.from || addDays(today, -30);
  const to = searchParams.to || today;
  const millFilter = searchParams.mill || '';
  const range = { gte: new Date(from + 'T00:00:00'), lte: new Date(to + 'T23:59:59') };
  const weekStart = new Date(addDays(today, -7) + 'T00:00:00');

  const [mills, pendingIntake, pendingQc, pendingProd, qcWeek, batchesWeek] = await Promise.all([
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.intakeReport.findMany({ where: { status: 'SUBMITTED' }, include: { material: true, supplier: true }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    prisma.qcReport.findMany({ where: { status: 'SUBMITTED' }, include: { product: true, batch: { include: { mill: true } } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    prisma.productionReport.findMany({ where: { status: 'SUBMITTED' }, include: { mill: true, batch: true }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    prisma.qcReport.findMany({ where: { dateAd: { gte: weekStart }, overallResult: { not: null } } }),
    prisma.batch.count({ where: { createdAt: { gte: weekStart } } }),
  ]);

  const pendingCount = pendingIntake.length + pendingQc.length + pendingProd.length;
  const passWeek = qcWeek.filter((q) => q.overallResult === 'PASS').length;
  const passRate = qcWeek.length ? Math.round((passWeek / qcWeek.length) * 100) : null;

  // ---- parameter trend ----
  const productsWithQc = await prisma.product.findMany({
    where: { hasQcSheet: true, active: true, ...(millFilter ? { millId: millFilter } : {}) },
    orderBy: [{ mill: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    include: { parameters: { where: { active: true, valueType: 'NUMBER' }, orderBy: { sortOrder: 'asc' } } },
  });
  const trendProduct = productsWithQc.find((p) => p.id === searchParams.tp) ?? productsWithQc[0];
  const trendParam = trendProduct?.parameters.find((p) => p.id === searchParams.pp) ?? trendProduct?.parameters.find((p) => p.name.includes('Moisture')) ?? trendProduct?.parameters[0];

  let trendPoints: { label: string; value: number }[] = [];
  let specMin: number | null = null;
  let specMax: number | null = null;
  if (trendParam) {
    const results = await prisma.qcResult.findMany({
      where: { parameterId: trendParam.id, resultNum: { not: null }, report: { dateAd: range } },
      include: { report: true },
      orderBy: { report: { dateAd: 'asc' } },
      take: 60,
    });
    trendPoints = results.map((r) => ({ label: adIso(r.report.dateAd).slice(5), value: r.resultNum! }));
    const spec = await prisma.specVersion.findFirst({ where: { parameterId: trendParam.id }, orderBy: { version: 'desc' } });
    specMin = spec?.min ?? null;
    specMax = spec?.max ?? null;
  }

  // ---- yield & efficiency trend ----
  const prodReports = await prisma.productionReport.findMany({
    where: { dateAd: range, ...(millFilter ? { millId: millFilter } : {}) },
    include: { inputs: true, rows: { include: { product: true } }, downtime: true },
    orderBy: { dateAd: 'asc' },
    take: 60,
  });
  const yieldPoints = prodReports
    .map((r) => {
      const net = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
      const main = r.rows.filter((x) => x.product.kind === 'PRODUCT').reduce((a, x) => a + rowTotalKg(x.semiFinishedKg, parsePacked(x.packedKg)), 0);
      return net ? { label: adIso(r.dateAd).slice(5), value: round2((main / net) * 100) } : null;
    })
    .filter(Boolean) as { label: string; value: number }[];
  const effPoints = prodReports
    .map((r) => {
      const sm = shiftMinutes(r.startTime, r.closeTime);
      const e = efficiencyPct(sm, r.breakdownMin ?? 0);
      return e !== null ? { label: adIso(r.dateAd).slice(5), value: e } : null;
    })
    .filter(Boolean) as { label: string; value: number }[];

  // ---- downtime pareto ----
  const downtime = await prisma.downtimeEntry.findMany({
    where: { report: { dateAd: range, ...(millFilter ? { millId: millFilter } : {}) } },
  });
  const paretoMap = new Map<string, number>();
  for (const d of downtime) {
    const key = d.department || d.rootCause || 'Unspecified';
    paretoMap.set(key, (paretoMap.get(key) ?? 0) + (d.durationMin ?? 0));
  }
  const pareto = [...paretoMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);

  // ---- supplier scorecard ----
  const intakes = await prisma.intakeReport.findMany({
    where: { dateAd: range, supplierId: { not: null } },
    include: { supplier: true, results: { include: { parameter: true } } },
  });
  const bySupplier = new Map<string, { name: string; lots: number; accepted: number; deducted: number; rejected: number; moistureSum: number; moistureN: number }>();
  for (const r of intakes) {
    const s = bySupplier.get(r.supplierId!) ?? { name: r.supplier!.name, lots: 0, accepted: 0, deducted: 0, rejected: 0, moistureSum: 0, moistureN: 0 };
    s.lots++;
    if (r.decision === 'ACCEPTED') s.accepted++;
    if (r.decision === 'ACCEPTED_DEDUCTION') s.deducted++;
    if (r.decision === 'REJECTED') s.rejected++;
    const moisture = r.results.find((x) => x.parameter.name === 'Moisture Content' && x.valueNum !== null);
    if (moisture) { s.moistureSum += moisture.valueNum!; s.moistureN++; }
    bySupplier.set(r.supplierId!, s);
  }
  const scorecard = [...bySupplier.values()].sort((a, b) => b.lots - a.lots);

  const isManager = canApprove(user.role);
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ from, to, mill: millFilter, tp: trendProduct?.id ?? '', pp: trendParam?.id ?? '', ...patch });
    return `/?${p.toString()}`;
  };

  return (
    <Shell user={user} active="/">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Namaste, {user.name.split(' ')[0]} 👋</h1>
          <p className="text-sm text-stone-500">Here&apos;s how the plant is doing.</p>
        </div>
        <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
          <label>Mill<br /><select name="mill" defaultValue={millFilter} className="field w-40"><option value="">All mills</option>{mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>From<br /><input type="date" name="from" defaultValue={from} className="field w-36" /></label>
          <label>To<br /><input type="date" name="to" defaultValue={to} className="field w-36" /></label>
          <button className="btn-secondary">Apply</button>
        </form>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Waiting for approval" value={String(pendingCount)} tone={pendingCount ? 'warn' : 'good'} hint={pendingCount ? 'act below' : 'all clear'} />
        <StatTile label="QC pass rate (7 days)" value={passRate !== null ? `${passRate}%` : '—'} tone={passRate !== null && passRate < 90 ? 'warn' : 'good'} hint={`${passWeek}/${qcWeek.length} sheets passed`} />
        <StatTile label="Batches this week" value={String(batchesWeek)} />
        <StatTile label="Downtime in range" value={`${Math.round(pareto.reduce((a, p) => a + p.value, 0))} min`} />
      </div>

      {pendingCount > 0 && (
        <Card title="Waiting for approval" className="mb-4">
          <ul className="divide-y divide-stone-100 text-sm">
            {pendingIntake.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">Intake</span>
                <Link href={`/intake/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.reportNo}</Link>
                <span>{r.material.name} · {r.supplier?.name ?? 'no supplier'}</span>
                <span className="flex-1" />
                {isManager && (
                  <form action={quickApprove}><input type="hidden" name="type" value="intake" /><input type="hidden" name="id" value={r.id} /><button className="btn-primary">Approve</button></form>
                )}
              </li>
            ))}
            {pendingQc.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">QC</span>
                <Link href={`/qc/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.reportNo}</Link>
                <span>{r.batch.mill.name} · {r.product.name} · {r.batch.batchNo}</span>
                <PassFailBadge result={r.overallResult} />
                <span className="flex-1" />
                {isManager && (
                  <form action={quickApprove}><input type="hidden" name="type" value="qc" /><input type="hidden" name="id" value={r.id} /><button className="btn-primary">Approve</button></form>
                )}
              </li>
            ))}
            {pendingProd.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">Production</span>
                <Link href={`/production/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.reportNo}</Link>
                <span>{r.mill.name} · {r.batch.batchNo}</span>
                <span className="flex-1" />
                {isManager && (
                  <form action={quickApprove}><input type="hidden" name="type" value="production" /><input type="hidden" name="id" value={r.id} /><button className="btn-primary">Approve</button></form>
                )}
              </li>
            ))}
          </ul>
          {!isManager && <p className="mt-2 text-xs text-stone-400">Only a Manager can approve — this list is read-only for you.</p>}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Parameter trend — ${trendProduct?.name ?? ''}: ${trendParam?.name ?? ''}`}>
          <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
            {productsWithQc.slice(0, 8).map((p) => (
              <Link key={p.id} href={qs({ tp: p.id, pp: '' })} className={`rounded-full border px-2 py-0.5 ${p.id === trendProduct?.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>{p.name}</Link>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
            {trendProduct?.parameters.slice(0, 7).map((p) => (
              <Link key={p.id} href={qs({ pp: p.id })} className={`rounded-full border px-2 py-0.5 ${p.id === trendParam?.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>{p.name}</Link>
            ))}
          </div>
          <LineChart points={trendPoints} specMin={specMin} specMax={specMax} unit={trendParam?.unit === '%' || trendParam?.unit === '% by wt' ? '%' : ''} />
          <p className="mt-1 text-xs text-stone-400">Dashed line = spec limit in force. Approved + submitted sheets, {from} → {to}.</p>
        </Card>

        <Card title="Downtime Pareto — where the minutes go">
          <ParetoBars items={pareto} />
        </Card>

        <Card title="Main-product yield % per production day">
          <LineChart points={yieldPoints} unit="%" />
        </Card>

        <Card title="Shift efficiency % (production time ÷ shift time)">
          <LineChart points={effPoints} unit="%" />
        </Card>
      </div>

      <Card title="Supplier scorecard" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr><th className="py-1 pr-3">Supplier</th><th className="py-1 pr-3 text-right">Lots</th><th className="py-1 pr-3 text-right">Accepted</th><th className="py-1 pr-3 text-right">With deduction</th><th className="py-1 pr-3 text-right">Rejected</th><th className="py-1 pr-3 text-right">Acceptance %</th><th className="py-1 text-right">Avg moisture %</th></tr>
            </thead>
            <tbody>
              {scorecard.map((s) => (
                <tr key={s.name} className="border-t border-stone-100">
                  <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                  <td className="py-1.5 pr-3 text-right">{s.lots}</td>
                  <td className="py-1.5 pr-3 text-right">{s.accepted}</td>
                  <td className="py-1.5 pr-3 text-right">{s.deducted}</td>
                  <td className="py-1.5 pr-3 text-right">{s.rejected}</td>
                  <td className="py-1.5 pr-3 text-right">{s.lots ? Math.round(((s.accepted + s.deducted) / s.lots) * 100) : 0}%</td>
                  <td className="py-1.5 text-right">{s.moistureN ? (s.moistureSum / s.moistureN).toFixed(2) : '—'}</td>
                </tr>
              ))}
              {!scorecard.length && <tr><td colSpan={7} className="py-4 text-center text-stone-400">No intake lots in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Recent batches" className="mt-4">
        <RecentBatches millFilter={millFilter} />
      </Card>
    </Shell>
  );
}

async function RecentBatches({ millFilter }: { millFilter: string }) {
  const batches = await prisma.batch.findMany({
    where: millFilter ? { millId: millFilter } : {},
    include: { mill: true, qcReports: { include: { product: true } } },
    orderBy: { dateAd: 'desc' },
    take: 8,
  });
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {batches.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
          <Link href={`/batches/${b.id}`} className="font-medium text-brand-700 hover:underline">{b.batchNo}</Link>
          <span className="text-stone-500">{b.mill.name}</span>
          <DualDate ad={b.dateAd} bs={b.dateBs} />
          <span className="flex-1" />
          {b.qcReports.map((q) => (
            <span key={q.id} className="inline-flex items-center gap-1 text-xs">{q.product.name} <PassFailBadge result={q.overallResult} /></span>
          ))}
        </li>
      ))}
    </ul>
  );
}
