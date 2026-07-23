// Server-rendered SVG micro-charts (no chart library). One series per chart,
// one axis; spec limits drawn as reference lines; native <title> tooltips.
const INK = '#57534e'; // stone-600
const MUTED = '#a8a29e'; // stone-400
const GRID = '#e7e5e4'; // stone-200
const SERIES = '#2e7d32';
const LIMIT = '#b45309'; // amber-700 — status, not a series

export function LineChart({
  points,
  specMin,
  specMax,
  height = 180,
  width = 560,
  unit = '',
}: {
  points: { label: string; value: number }[];
  specMin?: number | null;
  specMax?: number | null;
  height?: number;
  width?: number;
  unit?: string;
}) {
  if (points.length === 0) return <p className="py-6 text-center text-sm text-stone-400">No data in this range yet.</p>;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const vals = points.map((p) => p.value);
  const cand = [...vals, ...(specMin != null ? [specMin] : []), ...(specMax != null ? [specMax] : [])];
  let lo = Math.min(...cand), hi = Math.max(...cand);
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * 0.12; hi += span * 0.12;
  const x = (i: number) => pad.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => pad.t + h - ((v - lo) / (hi - lo)) * h;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const showEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Trend chart">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={MUTED}>{fmt(t)}</text>
        </g>
      ))}
      {specMax != null && (
        <g>
          <line x1={pad.l} x2={width - pad.r} y1={y(specMax)} y2={y(specMax)} stroke={LIMIT} strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={width - pad.r} y={y(specMax) - 4} textAnchor="end" fontSize={10} fill={LIMIT}>max {fmt(specMax)}{unit}</text>
        </g>
      )}
      {specMin != null && (
        <g>
          <line x1={pad.l} x2={width - pad.r} y1={y(specMin)} y2={y(specMin)} stroke={LIMIT} strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={width - pad.r} y={y(specMin) + 12} textAnchor="end" fontSize={10} fill={LIMIT}>min {fmt(specMin)}{unit}</text>
        </g>
      )}
      <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={8} fill="transparent">
            <title>{`${p.label}: ${fmt(p.value)}${unit}`}</title>
          </circle>
          <circle cx={x(i)} cy={y(p.value)} r={3.5} fill={SERIES} stroke="#fff" strokeWidth={2} pointerEvents="none" />
          {i % showEvery === 0 && (
            <text x={x(i)} y={height - 8} textAnchor="middle" fontSize={9} fill={MUTED}>{p.label}</text>
          )}
        </g>
      ))}
      {points.length > 0 && (
        <text x={x(points.length - 1) - 6} y={y(points[points.length - 1].value) - 8} textAnchor="end" fontSize={10} fontWeight={600} fill={INK}>
          {fmt(points[points.length - 1].value)}{unit}
        </text>
      )}
    </svg>
  );
}

export function ParetoBars({ items, unit = 'min' }: { items: { label: string; value: number }[]; unit?: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-stone-400">No downtime recorded in this range. Good.</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2 text-sm" title={`${it.label}: ${it.value} ${unit}`}>
          <span className="w-28 shrink-0 truncate text-stone-600">{it.label}</span>
          <div className="h-4 flex-1 rounded-sm bg-stone-100">
            <div className="h-4 rounded-sm" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: SERIES }} />
          </div>
          <span className="w-16 shrink-0 text-right font-medium text-stone-700">{fmt(it.value)} {unit}</span>
        </div>
      ))}
    </div>
  );
}

export function StatTile({ label, value, hint, tone = 'default' }: { label: string; value: string; hint?: string; tone?: 'default' | 'good' | 'warn' }) {
  const toneCls = tone === 'good' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : 'text-stone-900';
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneCls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-400">{hint}</div>}
    </div>
  );
}

function fmt(n: number) {
  return Math.abs(n) >= 100 ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
