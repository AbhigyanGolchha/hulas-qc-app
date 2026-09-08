'use client';
// Shared workflow bar: Submit / Delete draft / Unlock + Print + SAP export.
// Approve/Reject live in the Digital sign-offs panel at the bottom of the page,
// next to the approver's signature slot — same place co-signers sign.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatusBadge } from './ui';

export function WorkflowBar({
  type,
  id,
  status,
  canApprove,
  canUnlock,
  beforeSubmit,
  sapEnabled = false,
}: {
  type: 'intake' | 'qc' | 'production';
  id: string;
  status: string;
  canApprove: boolean;
  canUnlock: boolean;
  beforeSubmit?: () => Promise<void>; // flush autosave first
  sapEnabled?: boolean; // shows the SAP JSON export only when the integration is switched on
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  async function act(action: string, needReason = false) {
    setError(null);
    setMissing([]);
    let reason: string | undefined;
    if (needReason) {
      reason = window.prompt('Reason for unlocking (goes to the audit log):') ?? undefined;
    }
    if (action === 'delete' && !window.confirm('Delete this draft? This cannot be undone.')) return;
    setBusy(true);
    try {
      if (action === 'submit' && beforeSubmit) await beforeSubmit();
      const res = await fetch(`/api/records/${type}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.missing) setMissing(data.missing);
        else setError(data.error || 'Something went wrong');
        return;
      }
      if (data.deleted) {
        router.push(`/${type}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} />
        {(status === 'DRAFT' || status === 'REJECTED') && (
          <button className="btn-primary" disabled={busy} onClick={() => act('submit')}>
            Submit for approval
          </button>
        )}
        {status === 'DRAFT' && (
          <button className="btn-danger" disabled={busy} onClick={() => act('delete')}>
            Delete draft…
          </button>
        )}
        {status === 'SUBMITTED' && canApprove && (
          <span className="text-sm text-stone-500">Review the sheet, then approve in the sign-offs panel below ↓</span>
        )}
        {status === 'APPROVED' && canUnlock && (
          <button className="btn-secondary" disabled={busy} onClick={() => act('unlock', true)}>
            Unlock for editing…
          </button>
        )}
        <a className="btn-secondary" href={`/print/${type}/${id}`} target="_blank">
          Print / PDF
        </a>
        {sapEnabled && (
          <a className="btn-secondary" href={`/api/export/${type}/${id}`} target="_blank">
            Export JSON (SAP)
          </a>
        )}
      </div>
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {missing.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div className="font-medium">Before submitting, please fill in:</div>
          <ul className="ml-5 list-disc">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
