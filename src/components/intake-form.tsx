'use client';
import { useMemo, useState } from 'react';
import { evaluate } from '@/lib/spec';
import { intakeValue, fmtMoney, fmtKg } from '@/lib/calc';
import { useAutosave, SaveIndicator } from './use-autosave';
import { DualDateInput } from './dual-date-input';
import { WorkflowBar } from './workflow-bar';
import { BAG_TYPES, DECISIONS, SEASONS, UNLOADING_PLACES } from '@/lib/constants';

export type IntakeTemplateRow = {
  parameterId: string;
  name: string;
  unit: string | null;
  valueType: string;
  options: string[] | null;
  spec: { operator: string; min: number | null; max: number | null; textExpected: string | null; displayText: string; sourceTag: string };
  valueNum: number | null;
  valueText: string | null;
  note: string | null;
};

export type IntakeFormData = {
  id: string;
  reportNo: string;
  status: string;
  materialName: string;
  header: {
    dateAd: string;
    dateBs: string;
    millId: string | null;
    supplierId: string | null;
    variety: string;
    challanNo: string;
    vehicleNo: string;
    unloadingPlace: string;
    weightKg: string;
    bags: string;
    bagType: string;
    season: string;
    decision: string;
    decisionReason: string;
    pricePerQuintal: string;
    weightCutKg: string;
    priceCutPerQuintal: string;
    deductionAmount: string;
    deductionRate: string;
    godownKeeper: string;
    checkedBy: string;
  };
  rows: IntakeTemplateRow[];
};

export function IntakeForm({
  initial,
  mills,
  suppliers,
  canApprove,
  canUnlock,
}: {
  initial: IntakeFormData;
  mills: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  canApprove: boolean;
  canUnlock: boolean;
}) {
  const [header, setHeader] = useState(initial.header);
  const [rows, setRows] = useState(initial.rows);
  const editable = ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(initial.status);
  const { saveState, notify, flushNow } = useAutosave(`/api/records/intake/${initial.id}`, editable);

  function snapshot(h = header, r = rows) {
    return {
      header: h,
      results: r.map((row) => ({ parameterId: row.parameterId, valueNum: row.valueNum, valueText: row.valueText, note: row.note })),
    };
  }
  function setH<K extends keyof IntakeFormData['header']>(key: K, value: string | null) {
    const next = { ...header, [key]: value ?? '' };
    setHeader(next);
    notify(snapshot(next));
  }
  function setRow(i: number, patch: Partial<IntakeTemplateRow>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    notify(snapshot(header, next));
  }

  const outOfSpec = useMemo(
    () => rows.filter((r) => evaluate(r.spec, r.valueType, r.valueNum, r.valueText) === 'FAIL').map((r) => r.name),
    [rows],
  );

  const n = (s: string) => (s === '' ? null : Number(s));
  const showDeductions = header.decision === 'ACCEPTED_DEDUCTION';
  const value = intakeValue({
    weightKg: n(header.weightKg),
    pricePerQuintal: n(header.pricePerQuintal),
    weightCutKg: showDeductions ? n(header.weightCutKg) : null,
    priceCutPerQuintal: showDeductions ? n(header.priceCutPerQuintal) : null,
    flatDeduction: showDeductions ? n(header.deductionAmount) : null,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WorkflowBar type="intake" id={initial.id} status={initial.status} canApprove={canApprove} canUnlock={canUnlock} beforeSubmit={flushNow} />
        <SaveIndicator state={saveState} />
      </div>

      {/* ---------- Header ---------- */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <span className="mb-1 block text-sm font-medium">Date</span>
            <DualDateInput ad={header.dateAd} disabled={!editable} onChange={(ad, bs) => { const next = { ...header, dateAd: ad, dateBs: bs }; setHeader(next); notify(snapshot(next)); }} />
          </div>
          <L label="Variety / grade name"><input className="field" disabled={!editable} value={header.variety} onChange={(e) => setH('variety', e.target.value)} placeholder="e.g. Nepali Wheat" /></L>
          <L label="Supplier / Party name">
            <select className="field" disabled={!editable} value={header.supplierId ?? ''} onChange={(e) => setH('supplierId', e.target.value || null)}>
              <option value="">— choose —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </L>
          <L label="Destination mill">
            <select className="field" disabled={!editable} value={header.millId ?? ''} onChange={(e) => setH('millId', e.target.value || null)}>
              <option value="">— not decided —</option>
              {mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </L>
          <L label="Challan No."><input className="field" disabled={!editable} value={header.challanNo} onChange={(e) => setH('challanNo', e.target.value)} placeholder="94/95" /></L>
          <L label="Vehicle No."><input className="field" disabled={!editable} value={header.vehicleNo} onChange={(e) => setH('vehicleNo', e.target.value)} placeholder="Bhe1 kha 1547" /></L>
          <L label="Place of unloading">
            <select className="field" disabled={!editable} value={header.unloadingPlace} onChange={(e) => setH('unloadingPlace', e.target.value)}>
              <option value="">— choose —</option>
              {UNLOADING_PLACES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </L>
          <L label="Weight (kg)"><input className="field" type="number" inputMode="decimal" disabled={!editable} value={header.weightKg} onChange={(e) => setH('weightKg', e.target.value)} placeholder="25600" /></L>
          <L label="No. of bags"><input className="field" type="number" inputMode="numeric" disabled={!editable} value={header.bags} onChange={(e) => setH('bags', e.target.value)} placeholder="500" /></L>
          <L label="Bag type">
            <select className="field" disabled={!editable} value={header.bagType} onChange={(e) => setH('bagType', e.target.value)}>
              <option value="">—</option>
              {BAG_TYPES.map((b) => <option key={b}>{b}</option>)}
            </select>
          </L>
          <L label="Season">
            <select className="field" disabled={!editable} value={header.season} onChange={(e) => setH('season', e.target.value)}>
              <option value="">—</option>
              {SEASONS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </L>
        </div>
      </section>

      {/* ---------- Test results ---------- */}
      <section className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="w-8 px-3 py-2">#</th>
              <th className="px-3 py-2">Parameter</th>
              <th className="px-3 py-2">Standard specification</th>
              <th className="w-44 px-3 py-2">Result</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const status = evaluate(row.spec, row.valueType, row.valueNum, row.valueText);
              const cls = status === 'PASS' ? 'cell-pass' : status === 'FAIL' ? 'cell-fail' : '';
              return (
                <tr key={row.parameterId} className="border-t border-stone-100">
                  <td className="px-3 py-1.5 text-stone-400">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium">{row.name}</td>
                  <td className="px-3 py-1.5 text-stone-600">
                    {row.spec.displayText}
                    {row.spec.sourceTag === 'REFERENCE' && <span title="Reference value from published standards — verify vs Nepal NS/DFTQC"> 📖</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.valueType === 'NUMBER' ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" step="any" inputMode="decimal"
                          className={`field ${cls}`}
                          disabled={!editable}
                          value={row.valueNum ?? ''}
                          onChange={(e) => setRow(i, { valueNum: e.target.value === '' ? null : Number(e.target.value) })}
                          placeholder="not tested"
                        />
                        {row.unit && <span className="whitespace-nowrap text-xs text-stone-500">{row.unit}</span>}
                      </div>
                    ) : row.options ? (
                      <select className={`field ${cls}`} disabled={!editable} value={row.valueText ?? ''} onChange={(e) => setRow(i, { valueText: e.target.value || null })}>
                        <option value="">— not tested —</option>
                        {row.options.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className={`field ${cls}`} disabled={!editable} value={row.valueText ?? ''} onChange={(e) => setRow(i, { valueText: e.target.value || null })} placeholder="not tested" />
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <input className="field" disabled={!editable} value={row.note ?? ''} onChange={(e) => setRow(i, { note: e.target.value || null })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ---------- Purchase price ---------- */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Purchase price</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <L label={`Price agreed with supplier (₨ per quintal)`}>
            <input className="field" type="number" step="any" inputMode="decimal" disabled={!editable} value={header.pricePerQuintal} onChange={(e) => setH('pricePerQuintal', e.target.value)} placeholder="e.g. 3600" />
          </L>
          <L label="Lot value before deductions (auto)">
            <input className="field" disabled value={value.grossValue !== null ? fmtMoney(value.grossValue) : 'enter weight & price'} />
          </L>
        </div>
      </section>

      {/* ---------- Decision ---------- */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Decision</h2>
        {outOfSpec.length > 0 && (
          <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Out of spec: {outOfSpec.join(', ')}. You may want a deduction or rejection — your call, the form won&apos;t force it.
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <L label="Decision">
            <select className="field" disabled={!editable} value={header.decision} onChange={(e) => setH('decision', e.target.value)}>
              <option value="">— pending —</option>
              {Object.entries(DECISIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </L>
          {(header.decision === 'ACCEPTED_DEDUCTION' || header.decision === 'REJECTED') && (
            <L label="Reason (required)"><input className="field" disabled={!editable} value={header.decisionReason} onChange={(e) => setH('decisionReason', e.target.value)} /></L>
          )}
        </div>
        {showDeductions && (
          <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
            <div className="mb-2 text-sm font-medium text-stone-700">Deductions — fill any that apply, the math updates live</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <L label="Weight cut / katti (kg off payable weight)">
                <input className="field" type="number" step="any" disabled={!editable} value={header.weightCutKg} onChange={(e) => setH('weightCutKg', e.target.value)} placeholder="e.g. 512" />
              </L>
              <L label="Price cut (₨ per quintal off the rate)">
                <input className="field" type="number" step="any" disabled={!editable} value={header.priceCutPerQuintal} onChange={(e) => setH('priceCutPerQuintal', e.target.value)} placeholder="e.g. 50" />
              </L>
              <L label="Flat deduction (₨)">
                <input className="field" type="number" step="any" disabled={!editable} value={header.deductionAmount} onChange={(e) => setH('deductionAmount', e.target.value)} placeholder="e.g. 5000" />
              </L>
            </div>
            {value.grossValue !== null ? (
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label="Lot value at agreed price" value={fmtMoney(value.grossValue)} />
                <Stat label="Total deduction" value={fmtMoney(value.totalDeduction)} accent={!!value.totalDeduction} />
                <Stat label="We pay the supplier" value={fmtMoney(value.payableValue)} strong />
                <Stat label="Effective rate per quintal" value={fmtMoney(value.effectiveRatePerQuintal)} sub={`payable weight ${fmtKg(value.payableWeightKg)} kg`} />
              </div>
            ) : (
              <div className="mt-3 text-sm text-stone-500">Enter the weight (header) and the purchase price above to see the payable amount.</div>
            )}
          </div>
        )}
        <p className="mt-4 text-xs text-stone-500">
          Sign-offs are digital now — see the <b>Digital sign-offs</b> panel below. Submitting signs
          your slot; the godown keeper co-signs there; approval signs the manager slot.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, strong, accent }: { label: string; value: string; sub?: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`rounded border px-2.5 py-1.5 ${strong ? 'border-brand-100 bg-brand-50' : 'border-stone-200 bg-white'}`}>
      <div className="text-[11px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`font-semibold ${strong ? 'text-brand-700' : accent ? 'text-red-700' : 'text-stone-800'}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {children}
    </label>
  );
}
