'use client';
// Enter either calendar; the other converts live. AD via native date input,
// BS as YYYY-MM-DD text (Miti preview shown alongside).
import { useState } from 'react';
import { adToBs, bsToAd, formatMiti } from '@/lib/dates';

export function DualDateInput({
  ad,
  onChange,
  disabled,
}: {
  ad: string; // "YYYY-MM-DD"
  onChange: (ad: string, bs: string) => void;
  disabled?: boolean;
}) {
  const [bsDraft, setBsDraft] = useState<string | null>(null);
  const bs = bsDraft ?? (ad ? adToBs(ad) : '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-stone-500">AD</span>
        <input
          type="date"
          className="field w-40"
          value={ad}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setBsDraft(null);
            onChange(v, adToBs(v));
          }}
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-stone-500">BS</span>
        <input
          type="text"
          className="field w-32"
          placeholder="2083-01-03"
          value={bs}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setBsDraft(v);
            if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
              const newAd = bsToAd(v);
              if (newAd) {
                onChange(newAd, v);
                setBsDraft(null);
              }
            }
          }}
        />
      </label>
      {bs && /^\d{4}-\d{1,2}-\d{1,2}$/.test(bs) && (
        <span className="text-xs text-stone-500">Miti {formatMiti(bs)}</span>
      )}
    </div>
  );
}
