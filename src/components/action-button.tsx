'use client';
import { useFormStatus } from 'react-dom';

// Submit button for server-action forms that shows a busy state while the
// action runs (SAP calls can take many seconds — silence reads as "broken").
export function ActionButton({
  children,
  busyLabel,
  className = 'btn-secondary',
}: {
  children: React.ReactNode;
  busyLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={`${className} ${pending ? 'cursor-wait opacity-60' : ''}`} disabled={pending} aria-busy={pending}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {busyLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
