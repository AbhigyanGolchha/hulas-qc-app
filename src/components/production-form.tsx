'use client';
import { useMemo, useState } from 'react';
import { useAutosave, SaveIndicator } from './use-autosave';
import { DualDateInput } from './dual-date-input';
import { WorkflowBar } from './workflow-bar';
import { shiftMinutes, durationMinutes, efficiencyPct, fmtMinutes, fmtKg, fmtPct, rowTotalKg, checkYields, round2, unitsToKg, packedTotalKg, netInputKg, fmtInt, lotConsumedKg, parseVendors, VENDOR_SEP, countsInOutput } from '@/lib/calc';
import { BAG_TYPES, DOWNTIME_DEPARTMENTS } from '@/lib/constants';

type InputRow = { invoiceNo: string; kantaKg: number | null; boraKg: number | null; bagType: string; intakeReportId: string };
// packedUnits = bags/packets per pack size (what the floor counts); kg is derived
type ProdRow = { productId: string; productName: string; kind: string; semiFinishedKg: number | null; packedUnits: Record<string, number> };
type DtRow = { fromTime: string; toTime: string; department: string; rootCause: string };
type Pack = { id: string; label: string; grams: number };
// an intake lot offered for linking; availableKg = lot weight − other reports' use (null = weight not recorded)
export type IntakeOption = { id: string; label: string; supplierName: string | null; weightKg: number | null; availableKg: number | null };

export type ProductionFormData = {
  id: string;
  status: string;
  millName: string;
  processFields: string[];
  yieldLimits: { totalRecoveryMin: number | null; totalRecoveryMax: number | null; mainYieldMin: number | null; mainYieldMax: number | null };
  header: {
    dateAd: string; dateBs: string;
    packagingHours: string; vendors: string;
    manpower: string; startTime: string; closeTime: string;
    breakdownMin: string; breakdownOverridden: boolean;
    cumulativeMT: string; electricityKwh: string; voltage: string; cumulativeKwh: string;
    soakTimeHrs: string; roastTempC: string; saltNotes: string;
    preparedBy: string;
  };
  inputs: InputRow[];
  rows: ProdRow[];
  downtime: DtRow[];
};

export function ProductionForm({
  initial,
  packSizes,
  intakeOptions,
  suppliers,
  canApprove,
  canUnlock,
  sapEnabled = false,
  canDelete = false,
  canSubmit = true,
}: {
  initial: ProductionFormData;
  packSizes: Pack[];
  intakeOptions: IntakeOption[];
  suppliers: string[]; // supplier master — the only names Vendor(s) accepts
  canApprove: boolean;
  canUnlock: boolean;
  sapEnabled?: boolean;
  canDelete?: boolean;
  canSubmit?: boolean;
}) {
  const [header, setHeader] = useState(initial.header);
  const [inputs, setInputs] = useState<InputRow[]>(initial.inputs.length ? initial.inputs : [emptyInput()]);
  const [rows, setRows] = useState<ProdRow[]>(initial.rows);
  const [downtime, setDowntime] = useState<DtRow[]>(initial.downtime);
  const editable = ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(initial.status);
  const { saveState, saveError, notify, flushNow } = useAutosave(`/api/records/production/${initial.id}`, editable);

  function emptyInput(): InputRow {
    return { invoiceNo: '', kantaKg: null, boraKg: null, bagType: '', intakeReportId: '' };
  }

  function snapshot(h = header, ins = inputs, rs = rows, dts = downtime) {
    const extras: Record<string, string> = {};
    for (const f of initial.processFields) extras[f] = (h as any)[f] ?? '';
    return {
      header: { ...h, vendorList: parseVendors(h.vendors), processExtras: initial.processFields.length ? extras : null },
      inputs: ins.map((i) => ({ ...i, intakeReportId: i.intakeReportId || null })),
      rows: rs.map((r) => ({ productId: r.productId, semiFinishedKg: r.semiFinishedKg, packedUnits: r.packedUnits })),
      downtime: dts.map((d) => ({ ...d, durationMin: durationMinutes(d.fromTime, d.toTime) })),
    };
  }
  const push = (h = header, ins = inputs, rs = rows, dts = downtime) => notify(snapshot(h, ins, rs, dts));

  function setH<K extends keyof ProductionFormData['header']>(key: K, value: ProductionFormData['header'][K]) {
    const next = { ...header, [key]: value };
    setHeader(next);
    push(next);
  }

  // ---- vendors (supplier master only; old free text is flagged until removed) ----
  const vendorList = parseVendors(header.vendors);
  const supplierSet = new Set(suppliers);
  const setVendors = (list: string[], ins = inputs) => {
    const next = { ...header, vendors: list.join(VENDOR_SEP) };
    setHeader(next);
    push(next, ins);
  };

  // ---- intake lots: what is left of each lot for each row ----
  const lotById = new Map(intakeOptions.map((o) => [o.id, o]));
  const takenHere = (lotId: string, exceptRow = -1) =>
    inputs.reduce((a, inp, idx) => (idx !== exceptRow && inp.intakeReportId === lotId ? a + lotConsumedKg(inp) : a), 0);
  const leftFor = (lotId: string, row: number) => {
    const lot = lotById.get(lotId);
    return lot?.availableKg == null ? null : lot.availableKg - takenHere(lotId, row);
  };
  const overAllocated = [...new Set(inputs.map((i) => i.intakeReportId).filter(Boolean))]
    .map((id) => ({ lot: lotById.get(id), taken: takenHere(id) }))
    .filter((x) => x.lot && x.lot.availableKg != null && x.taken > x.lot.availableKg + 0.5);

  // ---- computed ----
  const netInput = inputs.reduce((a, i) => a + (netInputKg(i.kantaKg, i.boraKg) ?? 0), 0);
  const badTare = inputs.some((i) => i.kantaKg !== null && i.boraKg !== null && i.boraKg > i.kantaKg);
  const autoBreakdown = downtime.reduce((a, d) => a + (durationMinutes(d.fromTime, d.toTime) ?? 0), 0);
  const breakdown = header.breakdownOverridden && header.breakdownMin !== '' ? Number(header.breakdownMin) : autoBreakdown;
  const shiftMin = shiftMinutes(header.startTime, header.closeTime);
  const prodMin = shiftMin !== null ? Math.max(0, shiftMin - breakdown) : null;
  const eff = efficiencyPct(shiftMin, breakdown);
  const packedKgOf = (r: ProdRow) => unitsToKg(r.packedUnits, packSizes);
  const rowTotal = (r: ProdRow) => rowTotalKg(r.semiFinishedKg, packedKgOf(r));
  // loss rows (dust) are recorded but stay out of the output and every %
  const outRows = rows.filter((r) => countsInOutput(r.kind));
  const totalOutput = outRows.reduce((a, r) => a + rowTotal(r), 0);
  const totalPacked = outRows.reduce((a, r) => a + packedTotalKg(packedKgOf(r)), 0);
  const totalLoose = outRows.reduce((a, r) => a + (r.semiFinishedKg || 0), 0);
  const mainOutput = rows.filter((r) => r.kind === 'PRODUCT').reduce((a, r) => a + rowTotal(r), 0);
  const yields = useMemo(
    () => checkYields(netInput, totalOutput, mainOutput, initial.yieldLimits),
    [netInput, totalOutput, mainOutput, initial.yieldLimits],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WorkflowBar type="production" id={initial.id} status={initial.status} canApprove={canApprove} canUnlock={canUnlock} beforeSubmit={flushNow} sapEnabled={sapEnabled} canDelete={canDelete} canSubmit={canSubmit} />
        <SaveIndicator state={saveState} error={saveError} />
      </div>

      {/* Yield at a glance — the number this whole report exists for */}
      <section className="rounded-xl border-2 border-brand-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Yield — {initial.millName}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <YieldTile label="Raw material in (net)" value={netInput ? `${fmtKg(netInput)} kg` : '—'} />
          <YieldTile label="Total out (all products)" value={totalOutput ? `${fmtKg(totalOutput)} kg` : '—'} band={totalOutput ? `${fmtKg(totalPacked)} kg packed + ${fmtKg(totalLoose)} kg loose` : undefined} />
          <YieldTile
            label="Total recovery"
            value={yields.totalRecoveryPct !== null ? fmtPct(yields.totalRecoveryPct) : '—'}
            band={bandText(initial.yieldLimits.totalRecoveryMin, initial.yieldLimits.totalRecoveryMax)}
            tone={tone(yields.totalRecoveryPct, initial.yieldLimits.totalRecoveryMin, initial.yieldLimits.totalRecoveryMax)}
          />
          <YieldTile
            label="Main-product yield"
            value={yields.mainYieldPct !== null ? fmtPct(yields.mainYieldPct) : '—'}
            band={bandText(initial.yieldLimits.mainYieldMin, initial.yieldLimits.mainYieldMax)}
            tone={tone(yields.mainYieldPct, initial.yieldLimits.mainYieldMin, initial.yieldLimits.mainYieldMax)}
          />
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Total recovery = all output ÷ net input. Main-product yield = main products only (by-products excluded) ÷ net input.
        </p>
        {yields.warnings.map((w) => (
          <div key={w} className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{w}</div>
        ))}
      </section>

      {/* Header */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Date (Miti ↔ AD)</span>
            <DualDateInput ad={header.dateAd} disabled={!editable} onChange={(ad, bs) => { const n = { ...header, dateAd: ad, dateBs: bs }; setHeader(n); push(n); }} />
          </div>
          <L label="Packaging time (hrs)"><input type="number" step="any" className="field" disabled={!editable} value={header.packagingHours} onChange={(e) => setH('packagingHours', e.target.value)} /></L>
          <div className="block text-sm">
            <span className="mb-1 block font-medium text-stone-700">Vendor(s)</span>
            <div className="flex flex-wrap gap-1.5">
              {vendorList.map((v) => (
                <span key={v} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${supplierSet.has(v) ? 'border-stone-300 bg-stone-50' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
                  title={supplierSet.has(v) ? '' : 'Typed by hand before Vendor(s) became a list — not in the supplier master. Pick the right supplier and remove this.'}>
                  {v}{!supplierSet.has(v) && ' ⚠'}
                  {editable && <button type="button" className="text-stone-400 hover:text-red-600" onClick={() => setVendors(vendorList.filter((x) => x !== v))} aria-label={`Remove ${v}`}>✕</button>}
                </span>
              ))}
            </div>
            {editable && (
              <select className="field mt-1" value="" onChange={(e) => e.target.value && setVendors([...vendorList, e.target.value])}>
                <option value="">+ add vendor…</option>
                {suppliers.filter((x) => !vendorList.includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
            {vendorList.some((v) => !supplierSet.has(v)) && (
              <p className="mt-1 text-xs text-amber-700">⚠ = old hand-typed text, not a supplier from the list. Replace it with the right supplier(s).</p>
            )}
          </div>
        </div>
      </section>

      {/* Section A — raw material input */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">A · Raw material input</h2>
        <p className="mb-3 text-xs text-stone-500">Net input = kanta (weighbridge) weight − bora (empty bag) weight, per line.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="py-1 pr-2">Invoice no.</th>
                <th className="py-1 pr-2">Kanta wt (kg)</th>
                <th className="py-1 pr-2">Bora wt (kg)</th>
                <th className="py-1 pr-2 text-right">Net input (kg)</th>
                <th className="py-1 pr-2">Bag</th>
                <th className="py-1 pr-2">Linked intake lot</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((inp, i) => {
                const bad = inp.kantaKg !== null && inp.boraKg !== null && inp.boraKg > inp.kantaKg;
                return (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-1 pr-2"><input className="field" disabled={!editable} value={inp.invoiceNo} onChange={(e) => updIn(i, { invoiceNo: e.target.value })} /></td>
                    <td className="py-1 pr-2"><input type="number" step="any" className="field" disabled={!editable} value={inp.kantaKg ?? ''} onChange={(e) => updIn(i, { kantaKg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                    <td className="py-1 pr-2"><input type="number" step="any" className={`field ${bad ? 'cell-fail' : ''}`} disabled={!editable} value={inp.boraKg ?? ''} onChange={(e) => updIn(i, { boraKg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                    <td className="py-1 pr-2 text-right font-medium">{inp.kantaKg !== null ? fmtKg(netInputKg(inp.kantaKg, inp.boraKg)) : '—'}</td>
                    <td className="py-1 pr-2">
                      <select className="field w-20" disabled={!editable} value={inp.bagType} onChange={(e) => updIn(i, { bagType: e.target.value })}>
                        <option value="">—</option>{BAG_TYPES.map((b) => <option key={b}>{b}</option>)}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <select className="field" disabled={!editable} value={inp.intakeReportId} onChange={(e) => linkLot(i, e.target.value)}>
                        <option value="">— none —</option>
                        {intakeOptions
                          .filter((o) => o.id === inp.intakeReportId || o.availableKg === null || (leftFor(o.id, i) ?? 0) > 0)
                          .map((o) => {
                            const left = leftFor(o.id, i);
                            const qty = o.weightKg == null ? 'weight not recorded'
                              : left !== null && left < o.weightKg ? `${fmtKg(Math.max(0, left))} kg left of ${fmtKg(o.weightKg)}`
                              : `${fmtKg(o.weightKg)} kg`;
                            return <option key={o.id} value={o.id}>{o.label} ({qty})</option>;
                          })}
                      </select>
                    </td>
                    <td className="py-1">{editable && <button className="text-stone-400 hover:text-red-600" onClick={() => { const n = inputs.filter((_, x) => x !== i); setInputs(n.length ? n : [emptyInput()]); push(header, n.length ? n : [emptyInput()]); }}>✕</button>}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-stone-200 font-semibold">
                <td className="py-2">Total</td><td></td><td></td>
                <td className="py-2 text-right">{fmtKg(netInput)}</td>
                <td colSpan={3}>
                  {editable && <button className="btn-secondary" onClick={() => { const n = [...inputs, emptyInput()]; setInputs(n); push(header, n); }}>+ row</button>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {overAllocated.map(({ lot, taken }) => (
          <div key={lot!.id} className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {lot!.label.split(' — ')[0]} has only {fmtKg(lot!.availableKg)} kg left, but the rows linked to it here add up to {fmtKg(taken)} kg (kanta weight). Fix the weights or link another lot — the report can&apos;t be submitted like this.
          </div>
        ))}
        {badTare && <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">A bora (empty bag) weight is heavier than its kanta (gross) weight — that line counts as 0 until fixed, and the report can&apos;t be submitted.</div>}
      </section>

      {/* Section B — shift / operations */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">B · Shift & operations</h2>
        <p className="mb-3 text-xs text-stone-500">Shift time = closing − starting (overnight shifts handled). Production time = shift − breakdown. Efficiency = production time ÷ shift time.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <L label="Man power"><input type="number" className="field" disabled={!editable} value={header.manpower} onChange={(e) => setH('manpower', e.target.value)} /></L>
          <L label="Starting time"><input type="time" className="field" disabled={!editable} value={header.startTime} onChange={(e) => setH('startTime', e.target.value)} /></L>
          <L label="Closing time"><input type="time" className="field" disabled={!editable} value={header.closeTime} onChange={(e) => setH('closeTime', e.target.value)} /></L>
          <L label="Shift time (auto)"><input className="field" disabled value={fmtMinutes(shiftMin)} /></L>
          <L label={`Breakdown min (auto = downtime log${header.breakdownOverridden ? ', overridden' : ''})`}>
            <div className="flex items-center gap-2">
              <input type="number" className="field" disabled={!editable || !header.breakdownOverridden}
                value={header.breakdownOverridden ? header.breakdownMin : String(autoBreakdown)}
                onChange={(e) => setH('breakdownMin', e.target.value)} />
              {editable && (
                <label className="flex items-center gap-1 whitespace-nowrap text-xs text-stone-500">
                  <input type="checkbox" checked={header.breakdownOverridden}
                    onChange={(e) => { const n = { ...header, breakdownOverridden: e.target.checked, breakdownMin: String(e.target.checked ? breakdown : autoBreakdown) }; setHeader(n); push(n); }} />
                  edit
                </label>
              )}
            </div>
          </L>
          <L label="Production time (auto)"><input className="field" disabled value={fmtMinutes(prodMin)} /></L>
          <L label="Efficiency % (auto)"><input className="field" disabled value={eff !== null ? `${eff}%` : '—'} /></L>
          <L label="Cumulative production (MT)"><input type="number" step="any" className="field" disabled={!editable} value={header.cumulativeMT} onChange={(e) => setH('cumulativeMT', e.target.value)} /></L>
          <L label="Electricity (kWh)"><input type="number" step="any" className="field" disabled={!editable} value={header.electricityKwh} onChange={(e) => setH('electricityKwh', e.target.value)} /></L>
          <L label="Voltage (V)"><input type="number" className="field" disabled={!editable} value={header.voltage} onChange={(e) => setH('voltage', e.target.value)} /></L>
          <L label="Cumulative kWh"><input type="number" step="any" className="field" disabled={!editable} value={header.cumulativeKwh} onChange={(e) => setH('cumulativeKwh', e.target.value)} /></L>
          {initial.processFields.includes('soakTimeHrs') && (
            <L label="Soak time (hrs)"><input type="number" step="any" className="field" disabled={!editable} value={header.soakTimeHrs} onChange={(e) => setH('soakTimeHrs', e.target.value)} /></L>
          )}
          {initial.processFields.includes('roastTempC') && (
            <L label="Roasting/puffing temp (°C)"><input type="number" step="any" className="field" disabled={!editable} value={header.roastTempC} onChange={(e) => setH('roastTempC', e.target.value)} /></L>
          )}
          {initial.processFields.includes('saltNotes') && (
            <L label="Salt conditioning notes"><input className="field" disabled={!editable} value={header.saltNotes} onChange={(e) => setH('saltNotes', e.target.value)} /></L>
          )}
        </div>
        {shiftMin !== null && breakdown > shiftMin && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">Breakdown ({fmtMinutes(breakdown)}) is longer than the whole shift ({fmtMinutes(shiftMin)}) — check the downtime log times.</div>
        )}
      </section>

      {/* Section C — production details */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">C · Production details</h2>
        <p className="mb-3 text-xs text-stone-500">
          Pack columns take the <b>number of bags / packets</b>; the app converts to kg using the pack size.{' '}
          <b>Semi-finished</b> is product that is still loose (in bins, not packed yet) — do not repeat the packed weight there.{' '}
          Row total = semi-finished + packed kg.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 860 + packSizes.length * 96 }}>
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="py-1 pr-2">Product</th>
                <th className="py-1 pr-2">Semi-finished<br /><span className="normal-case text-stone-400">loose, kg</span></th>
                {packSizes.map((p) => <th key={p.id} className="py-1 pr-2">{p.label}<br /><span className="normal-case text-stone-400">no. of {p.grams >= 20000 ? 'bags' : 'packets'}</span></th>)}
                <th className="py-1 pr-2 text-right">Packed<br /><span className="normal-case text-stone-400">(kg, auto)</span></th>
                <th className="py-1 pr-2 text-right">Row total<br /><span className="normal-case text-stone-400">(kg)</span></th>
                <th className="py-1 pr-2 text-right">% of input</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (countsInOutput(row.kind) ? renderRow(row, i) : null))}
              <tr className="border-t-2 border-stone-300 font-semibold">
                <td className="py-2">Total output</td>
                <td className="py-2 text-right pr-2">{totalLoose ? fmtKg(totalLoose) : ''}</td>
                {packSizes.map((p) => {
                  const n = rows.reduce((a, r) => a + (r.packedUnits[p.id] || 0), 0);
                  return <td key={p.id} className="py-2 pr-2 text-xs text-stone-500">{n ? `${fmtInt(n)} ${p.grams >= 20000 ? 'bags' : 'pkts'}` : ''}</td>;
                })}
                <td className="py-2 text-right pr-2 text-stone-600">{totalPacked ? fmtKg(totalPacked) : ''}</td>
                <td className="py-2 text-right">{fmtKg(totalOutput)}</td>
                <td className="py-2 text-right">{yields.totalRecoveryPct !== null ? fmtPct(yields.totalRecoveryPct) : '—'}</td>
              </tr>
              <tr className="text-sm font-semibold text-brand-700">
                <td className="py-1">Actual yield (main products)</td>
                <td colSpan={packSizes.length + 2}></td>
                <td className="py-1 text-right">{fmtKg(mainOutput)}</td>
                <td className="py-1 text-right">{yields.mainYieldPct !== null ? fmtPct(yields.mainYieldPct) : '—'}</td>
              </tr>
              {rows.some((r) => !countsInOutput(r.kind)) && (
                <tr className="border-t border-stone-200">
                  <td colSpan={packSizes.length + 5} className="pt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Recorded separately — not counted in total output or any %
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (countsInOutput(row.kind) ? null : renderRow(row, i)))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section D — downtime log */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">D · Downtime log</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr><th className="w-8 py-1">#</th><th className="py-1 pr-2">From</th><th className="py-1 pr-2">To</th><th className="py-1 pr-2">Duration</th><th className="py-1 pr-2">Department</th><th className="py-1 pr-2">Root cause of delay</th><th className="w-8"></th></tr>
            </thead>
            <tbody>
              {downtime.map((d, i) => (
                <tr key={i} className="border-t border-stone-100">
                  <td className="py-1 text-stone-400">{i + 1}</td>
                  <td className="py-1 pr-2"><input type="time" className="field w-28" disabled={!editable} value={d.fromTime} onChange={(e) => updDt(i, { fromTime: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input type="time" className="field w-28" disabled={!editable} value={d.toTime} onChange={(e) => updDt(i, { toTime: e.target.value })} /></td>
                  <td className="py-1 pr-2">{fmtMinutes(durationMinutes(d.fromTime, d.toTime))}</td>
                  <td className="py-1 pr-2">
                    <select className="field" disabled={!editable} value={d.department} onChange={(e) => updDt(i, { department: e.target.value })}>
                      <option value="">—</option>{DOWNTIME_DEPARTMENTS.map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2"><input className="field" disabled={!editable} value={d.rootCause} onChange={(e) => updDt(i, { rootCause: e.target.value })} /></td>
                  <td className="py-1">{editable && <button className="text-stone-400 hover:text-red-600" onClick={() => { const n = downtime.filter((_, x) => x !== i); setDowntime(n); push(header, inputs, rows, n); }}>✕</button>}</td>
                </tr>
              ))}
              {downtime.length > 0 && (
                <tr className="border-t border-stone-200 font-semibold">
                  <td></td><td className="py-1" colSpan={2}>Total downtime</td><td className="py-1 pr-2">{fmtMinutes(autoBreakdown)}</td><td colSpan={3}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && (
          <button className="btn-secondary mt-2" onClick={() => { const n = [...downtime, { fromTime: '', toTime: '', department: '', rootCause: '' }]; setDowntime(n); push(header, inputs, rows, n); }}>
            + downtime entry
          </button>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <p className="text-xs text-stone-500">
          &quot;Prepared by&quot; and &quot;Approved by&quot; are digital now — submitting signs for
          you, approval signs the manager slot. See the <b>Digital sign-offs</b> panel below.
        </p>
      </section>
    </div>
  );

  function renderRow(row: ProdRow, i: number) {
    const packedKg = packedKgOf(row);
    const packed = packedTotalKg(packedKg);
    const total = rowTotalKg(row.semiFinishedKg, packedKg);
    return (
      <tr key={row.productId} className={`border-t border-stone-100 ${row.kind !== 'PRODUCT' ? 'text-stone-600' : ''}`}>
        <td className="py-1 pr-2 font-medium">{row.productName}{row.kind === 'BYPRODUCT' && <span className="ml-1 text-xs text-stone-400">(by-product)</span>}{row.kind === 'LOSS' && <span className="ml-1 text-xs text-stone-400">(loss)</span>}</td>
        <td className="py-1 pr-2"><input type="number" step="any" className="field w-28" disabled={!editable} value={row.semiFinishedKg ?? ''} onChange={(e) => updRow(i, { semiFinishedKg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
        {packSizes.map((p) => (
          <td key={p.id} className="py-1 pr-2 align-top">
            <input type="number" step="any" min={0} className="field w-20" disabled={!editable}
              value={row.packedUnits[p.id] ?? ''}
              onChange={(e) => {
                const units = { ...row.packedUnits };
                if (e.target.value === '') delete units[p.id];
                else units[p.id] = Number(e.target.value);
                updRow(i, { packedUnits: units });
              }} />
            {packedKg[p.id] ? <div className="mt-0.5 text-[11px] text-stone-400">= {fmtKg(packedKg[p.id])} kg</div> : null}
          </td>
        ))}
        <td className="py-1 pr-2 text-right text-stone-600">{packed ? fmtKg(packed) : '—'}</td>
        <td className="py-1 pr-2 text-right font-medium">{total ? fmtKg(total) : '—'}</td>
        <td className="py-1 pr-2 text-right">{!countsInOutput(row.kind) ? <span className="text-xs text-stone-400">not counted</span> : netInput && total ? fmtPct(round2((total / netInput) * 100)) : '—'}</td>
      </tr>
    );
  }

  // linking a lot also adds its supplier to Vendor(s) (never removes any)
  function linkLot(i: number, lotId: string) {
    const n = inputs.map((x, idx) => (idx === i ? { ...x, intakeReportId: lotId } : x));
    setInputs(n);
    const sup = lotById.get(lotId)?.supplierName;
    if (sup && supplierSet.has(sup) && !vendorList.includes(sup)) setVendors([...vendorList, sup], n);
    else push(header, n);
  }
  function updIn(i: number, patch: Partial<InputRow>) {
    const n = inputs.map((x, idx) => (idx === i ? { ...x, ...patch } : x));
    setInputs(n);
    push(header, n);
  }
  function updRow(i: number, patch: Partial<ProdRow>) {
    const n = rows.map((x, idx) => (idx === i ? { ...x, ...patch } : x));
    setRows(n);
    push(header, inputs, n);
  }
  function updDt(i: number, patch: Partial<DtRow>) {
    const n = downtime.map((x, idx) => (idx === i ? { ...x, ...patch } : x));
    setDowntime(n);
    push(header, inputs, rows, n);
  }
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {children}
    </label>
  );
}

// green = inside the expected band, amber = outside it, neutral = no data yet
function tone(v: number | null, min: number | null, max: number | null): 'ok' | 'warn' | 'none' {
  if (v === null || (min === null && max === null)) return 'none';
  if ((min !== null && v < min) || (max !== null && v > max)) return 'warn';
  return 'ok';
}
function bandText(min: number | null, max: number | null): string | undefined {
  if (min === null && max === null) return undefined;
  return `expected ${min ?? '…'}–${max ?? '…'}%`;
}
function YieldTile({ label, value, band, tone: t }: { label: string; value: string; band?: string; tone?: 'ok' | 'warn' | 'none' }) {
  const cls =
    t === 'ok' ? 'border-green-300 bg-green-50 text-green-800'
    : t === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-800'
    : 'border-stone-200 bg-stone-50 text-stone-800';
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {band && <div className="text-xs opacity-70">{band}</div>}
    </div>
  );
}
