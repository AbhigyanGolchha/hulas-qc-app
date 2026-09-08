'use client';
import { useMemo, useState } from 'react';
import { evaluate, sampleAverage, suggestOverall } from '@/lib/spec';
import { useAutosave, SaveIndicator } from './use-autosave';
import { DualDateInput } from './dual-date-input';
import { WorkflowBar } from './workflow-bar';

export type QcTemplateRow = {
  parameterId: string;
  name: string;
  unit: string | null;
  valueType: string;
  options: string[] | null;
  sampleCount: number;
  hasIr: boolean;
  spec: { operator: string; min: number | null; max: number | null; textExpected: string | null; displayText: string; sourceTag: string };
  sample1: number | null;
  sample2: number | null;
  sample3: number | null;
  irMoisture: number | null;
  resultNum: number | null;
  resultText: string | null;
  resultOverridden: boolean;
  remarks: string | null;
};

export type QcFormData = {
  id: string;
  status: string;
  hasFortification: boolean;
  header: {
    dateAd: string;
    dateBs: string;
    analyst: string;
    overallResult: string;
    overallOverridden: boolean;
    overrideReason: string;
    remarks: string;
    premixBrand: string;
    premixLot: string;
    premixTarget: string;
    premixActual: string;
    doserWorking: '' | 'yes' | 'no';
    premixRemarks: string;
    checkedBy: string;
  };
  rows: QcTemplateRow[];
};

export function QcForm({ initial, canApprove, canUnlock, isManager, sapEnabled = false }: { initial: QcFormData; canApprove: boolean; canUnlock: boolean; isManager: boolean; sapEnabled?: boolean }) {
  const [header, setHeader] = useState(initial.header);
  const [rows, setRows] = useState(initial.rows);
  const editable = ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(initial.status);
  const { saveState, notify, flushNow } = useAutosave(`/api/records/qc/${initial.id}`, editable);

  function snapshot(h = header, r = rows) {
    return {
      header: { ...h, doserWorking: h.doserWorking === 'yes' ? true : h.doserWorking === 'no' ? false : null },
      results: r.map((row) => ({
        parameterId: row.parameterId,
        sample1: row.sample1, sample2: row.sample2, sample3: row.sample3,
        irMoisture: row.irMoisture,
        resultNum: row.resultNum, resultText: row.resultText,
        resultOverridden: row.resultOverridden,
        remarks: row.remarks,
      })),
    };
  }
  function setH<K extends keyof QcFormData['header']>(key: K, value: QcFormData['header'][K]) {
    const next = { ...header, [key]: value };
    setHeader(next);
    notify(snapshot(next));
  }
  function setRow(i: number, patch: Partial<QcTemplateRow>) {
    const next = rows.map((r, idx) => {
      if (idx !== i) return r;
      const merged = { ...r, ...patch };
      // auto-average unless overridden
      if (!merged.resultOverridden && ('sample1' in patch || 'sample2' in patch || 'sample3' in patch)) {
        merged.resultNum = sampleAverage([merged.sample1, merged.sample2, merged.sample3]);
      }
      return merged;
    });
    setRows(next);
    notify(snapshot(header, next));
  }

  const evaluated = useMemo(
    () => rows.map((r) => evaluate(r.spec, r.valueType, r.resultNum, r.resultText)),
    [rows],
  );
  const suggested = suggestOverall(evaluated);
  const shownOverall = header.overallOverridden ? header.overallResult : suggested ?? '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WorkflowBar type="qc" id={initial.id} status={initial.status} canApprove={canApprove} canUnlock={canUnlock} beforeSubmit={flushNow} sapEnabled={sapEnabled} />
        <SaveIndicator state={saveState} />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="mb-1 block text-sm font-medium">Date</span>
            <DualDateInput ad={header.dateAd} disabled={!editable} onChange={(ad, bs) => { const next = { ...header, dateAd: ad, dateBs: bs }; setHeader(next); notify(snapshot(next)); }} />
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Analyst</span>
            <input className="field w-48" disabled={!editable} value={header.analyst} onChange={(e) => setH('analyst', e.target.value)} />
          </label>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">Parameter checked</th>
              <th className="px-3 py-2">Standard specification</th>
              <th className="w-24 px-2 py-2">1st sample</th>
              <th className="w-24 px-2 py-2">2nd sample</th>
              <th className="w-24 px-2 py-2">3rd sample</th>
              <th className="w-24 px-2 py-2">IR moisture</th>
              <th className="w-32 px-2 py-2">Result obtained</th>
              <th className="w-28 px-2 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const status = evaluated[i];
              const cls = status === 'PASS' ? 'cell-pass' : status === 'FAIL' ? 'cell-fail' : '';
              const threeSample = row.sampleCount === 3;
              return (
                <tr key={row.parameterId} className="border-t border-stone-100">
                  <td className="px-3 py-1.5 font-medium">{row.name}{row.unit ? <span className="ml-1 font-normal text-xs text-stone-400">({row.unit})</span> : null}</td>
                  <td className="px-3 py-1.5 text-stone-600">
                    {row.spec.displayText}
                    {row.spec.sourceTag === 'REFERENCE' && <span title="Reference value — verify vs Nepal NS/DFTQC"> 📖</span>}
                  </td>
                  {[1, 2, 3].map((n) => (
                    <td key={n} className="px-2 py-1.5">
                      {row.valueType === 'NUMBER' && threeSample ? (
                        <input
                          type="number" step="any" inputMode="decimal" className="field"
                          disabled={!editable}
                          value={(row as any)[`sample${n}`] ?? ''}
                          onChange={(e) => setRow(i, { [`sample${n}`]: e.target.value === '' ? null : Number(e.target.value) } as any)}
                        />
                      ) : (
                        <span className="block text-center text-stone-300">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    {row.hasIr ? (
                      <input type="number" step="any" inputMode="decimal" className="field" disabled={!editable}
                        value={row.irMoisture ?? ''} onChange={(e) => setRow(i, { irMoisture: e.target.value === '' ? null : Number(e.target.value) })} />
                    ) : (
                      <span className="block text-center text-stone-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {row.valueType === 'NUMBER' ? (
                      <input
                        type="number" step="any" inputMode="decimal"
                        className={`field ${cls}`}
                        disabled={!editable}
                        value={row.resultNum ?? ''}
                        title={threeSample && !row.resultOverridden ? 'Auto-averaged from the samples — typing here overrides' : ''}
                        onChange={(e) => setRow(i, { resultNum: e.target.value === '' ? null : Number(e.target.value), resultOverridden: threeSample ? true : row.resultOverridden })}
                      />
                    ) : row.options ? (
                      <select className={`field ${cls}`} disabled={!editable} value={row.resultText ?? ''} onChange={(e) => setRow(i, { resultText: e.target.value || null })}>
                        <option value="">—</option>
                        {row.options.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className={`field ${cls}`} disabled={!editable} value={row.resultText ?? ''} onChange={(e) => setRow(i, { resultText: e.target.value || null })} />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <input className="field" disabled={!editable} value={row.remarks ?? ''} onChange={(e) => setRow(i, { remarks: e.target.value || null })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {initial.hasFortification && (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Fortification check</h2>
          <p className="mb-3 text-xs text-stone-500">Mill Atta is sold as fortified — record the premix dosing. No lab assay needed.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <L label="Premix brand"><input className="field" disabled={!editable} value={header.premixBrand} onChange={(e) => setH('premixBrand', e.target.value)} /></L>
            <L label="Premix lot no."><input className="field" disabled={!editable} value={header.premixLot} onChange={(e) => setH('premixLot', e.target.value)} /></L>
            <L label="Doser working?">
              <select className="field" disabled={!editable} value={header.doserWorking} onChange={(e) => setH('doserWorking', e.target.value as any)}>
                <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            </L>
            <L label="Dosing target (g/MT)"><input type="number" step="any" className="field" disabled={!editable} value={header.premixTarget} onChange={(e) => setH('premixTarget', e.target.value)} /></L>
            <L label="Dosing actual (g/MT)"><input type="number" step="any" className="field" disabled={!editable} value={header.premixActual} onChange={(e) => setH('premixActual', e.target.value)} /></L>
            <L label="Remarks"><input className="field" disabled={!editable} value={header.premixRemarks} onChange={(e) => setH('premixRemarks', e.target.value)} /></L>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Final status</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <L label={`Overall result ${header.overallOverridden ? '(manager override)' : '(auto-suggested)'}`}>
            <div className="flex items-center gap-2">
              <select
                className={`field ${shownOverall === 'PASS' ? 'cell-pass' : shownOverall === 'FAIL' ? 'cell-fail' : ''}`}
                disabled={!editable || (!isManager && header.overallOverridden) || !header.overallOverridden}
                value={shownOverall}
                onChange={(e) => setH('overallResult', e.target.value)}
              >
                <option value="">—</option><option value="PASS">PASS</option><option value="FAIL">FAIL</option>
              </select>
              {isManager && editable && (
                <label className="flex items-center gap-1 whitespace-nowrap text-xs text-stone-500">
                  <input type="checkbox" checked={header.overallOverridden}
                    onChange={(e) => { const next = { ...header, overallOverridden: e.target.checked, overallResult: shownOverall }; setHeader(next); notify(snapshot(next)); }} />
                  override
                </label>
              )}
            </div>
          </L>
          {header.overallOverridden && (
            <L label="Override reason (required)"><input className="field" disabled={!editable} value={header.overrideReason} onChange={(e) => setH('overrideReason', e.target.value)} /></L>
          )}
          <L label="Remarks"><input className="field" disabled={!editable} value={header.remarks} onChange={(e) => setH('remarks', e.target.value)} placeholder='e.g. "Accepted", "Ash of Suji is slightly low"' /></L>
        </div>
        <p className="mt-3 text-xs text-stone-500">
          &quot;Checked by&quot; and &quot;Approved by&quot; are digital now — submitting signs for you,
          approval signs for the GM. See the <b>Digital sign-offs</b> panel below.
        </p>
      </section>
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
