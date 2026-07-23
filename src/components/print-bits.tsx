import { formatAdLong, formatMiti } from '@/lib/dates';

export function PrintHeader({ title, companyName, sub }: { title: string; companyName: string; sub?: string }) {
  return (
    <header className="mb-3 border-b-2 border-black pb-2 text-center">
      <div className="text-lg font-bold uppercase tracking-wide">{companyName}</div>
      <div className="text-xs">Nepalgunj, Nepal</div>
      <div className="mt-1 text-base font-bold underline">{title}</div>
      {sub && <div className="text-xs">{sub}</div>}
    </header>
  );
}

export function PrintDates({ ad, bs }: { ad: Date; bs: string }) {
  return (
    <span>
      Date: <b>{formatAdLong(ad)}</b> &nbsp;·&nbsp; Miti: <b>{formatMiti(bs)}</b>
    </span>
  );
}

export function SignRow({ signs }: { signs: { label: string; name: string | null; at?: Date | null }[] }) {
  return (
    <div className="mt-8 flex flex-wrap justify-between gap-4">
      {signs.map((s) => (
        <div key={s.label} className="min-w-36 text-center">
          <div className="border-b border-black pb-4 font-medium">{s.name ?? ''}</div>
          <div className="mt-1 text-xs">{s.label}</div>
          {s.at && <div className="text-[10px] text-stone-600">{s.at.toISOString().replace('T', ' ').slice(0, 16)}</div>}
        </div>
      ))}
    </div>
  );
}

export const td = 'border border-black px-1.5 py-0.5';
export const th = 'border border-black px-1.5 py-0.5 text-left font-bold';
