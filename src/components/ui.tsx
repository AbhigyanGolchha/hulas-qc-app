import { STATUS_LABELS, type Status } from '@/lib/constants';
import { formatMiti } from '@/lib/dates';

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: 'bg-stone-100 text-stone-600 border-stone-300',
    SUBMITTED: 'bg-amber-50 text-amber-800 border-amber-300',
    APPROVED: 'bg-green-50 text-green-800 border-green-300',
    REJECTED: 'bg-red-50 text-red-800 border-red-300',
  };
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.DRAFT}`}>
      {STATUS_LABELS[status as Status] ?? status}
    </span>
  );
}

export function PassFailBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-xs text-stone-400">—</span>;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${
        result === 'PASS' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {result}
    </span>
  );
}

export function DualDate({ ad, bs }: { ad: Date | string; bs: string }) {
  const d = typeof ad === 'string' ? ad : `${ad.getFullYear()}-${String(ad.getMonth() + 1).padStart(2, '0')}-${String(ad.getDate()).padStart(2, '0')}`;
  return (
    <span className="whitespace-nowrap">
      {d} <span className="text-stone-400">·</span> <span title="Miti (BS)">Miti {formatMiti(bs)}</span>
    </span>
  );
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-stone-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-stone-500">{subtitle}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>}
      {children}
    </section>
  );
}
