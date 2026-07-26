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

export type PrintSign = { label: string; name: string | null; at?: Date | null; image?: string | null };

// Digital sign-off block: signature image (snapshot from signing time) with
// the signer's name and timestamp. No blank lines — nothing to sign on paper.
export function SignRow({ signs }: { signs: PrintSign[] }) {
  return (
    <div className="mt-8 flex flex-wrap justify-between gap-4">
      {signs.map((s) => (
        <div key={s.label} className="min-w-40 text-center">
          <div className="flex h-12 items-end justify-center border-b border-black pb-0.5">
            {s.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.image} alt={`Signature of ${s.name ?? ''}`} className="max-h-11 object-contain" />
            ) : (
              <span className="font-serif text-base italic">{s.name ?? ''}</span>
            )}
          </div>
          <div className="mt-0.5 text-xs font-medium">{s.name ?? '—'}</div>
          <div className="text-[10px]">{s.label}</div>
          {s.name && (
            <div className="text-[9px] text-stone-600">
              {s.at
                ? `Digitally signed ${s.at.toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} NPT`
                : 'Digitally signed'}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// map Signature rows to the print slots, with legacy name-field fallback.
// Signatures in slots the form didn't declare (extra approval stages from
// Admin → Approval flow) are appended so multi-step sign-offs always print.
export function toPrintSigns(
  slots: { slot: string; legacyName?: string | null; legacyAt?: Date | null }[],
  signatures: { slot: string; userName: string; imageData: string | null; signedAt: Date }[],
): PrintSign[] {
  const declared = slots.map(({ slot, legacyName, legacyAt }) => {
    const s = signatures.find((x) => x.slot === slot);
    return s
      ? { label: slot, name: s.userName, at: s.signedAt, image: s.imageData }
      : { label: slot, name: legacyName ?? null, at: legacyAt ?? null };
  });
  const extra = signatures
    .filter((s) => !slots.some((d) => d.slot === s.slot))
    .map((s) => ({ label: s.slot, name: s.userName, at: s.signedAt, image: s.imageData }));
  return [...declared, ...extra];
}

export const td = 'border border-black px-1.5 py-0.5';
export const th = 'border border-black px-1.5 py-0.5 text-left font-bold';
