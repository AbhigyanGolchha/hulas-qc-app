'use client';
// Digital sign-off panel shown on every record page. Each slot mirrors a
// signature line on the old paper form. Submitting signs the submitter's
// slot automatically; this panel covers co-signers (godown keeper) and shows
// everyone what's signed. The approver slot fills only via Approve.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SignaturePad } from './signature-pad';

export type SlotView = {
  slot: string;
  isApprover: boolean;
  isCurrentStage?: boolean; // the approval step this record is waiting on right now
  signedBy: string | null;
  signedAt: string | null; // ISO
  imageData: string | null;
};

export function SignoffPanel({
  type,
  id,
  status,
  slots,
  userHasSignature,
  canApprove = false,
}: {
  type: 'intake' | 'qc' | 'production';
  id: string;
  status: string;
  slots: SlotView[];
  userHasSignature: boolean;
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(false);
  const [padSaving, setPadSaving] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const editable = ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(status);

  async function sign(slot: string) {
    if (!userHasSignature && !showPad) {
      // first time: draw the signature right here, then sign
      setPendingSlot(slot);
      setShowPad(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/records/${type}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', slot }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Could not sign');
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: 'approve' | 'reject') {
    let reason: string | undefined;
    if (action === 'reject') {
      reason = window.prompt('Reason for rejection (required):') ?? undefined;
      if (!reason?.trim()) return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/records/${type}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Something went wrong');
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function savePadAndSign(dataUri: string) {
    setPadSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/me/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: dataUri }),
      });
      if (!res.ok) {
        setError((await res.json()).error || 'Could not save signature');
        return;
      }
      setShowPad(false);
      if (pendingSlot) {
        const res2 = await fetch(`/api/records/${type}/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sign', slot: pendingSlot }),
        });
        if (!res2.ok) setError((await res2.json()).error || 'Could not sign');
        setPendingSlot(null);
      }
      router.refresh();
    } finally {
      setPadSaving(false);
    }
  }

  return (
    <section className="no-print rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">Digital sign-offs</h2>
      <p className="mb-3 text-xs text-stone-500">
        Submitting signs your slot automatically. Approving signs the {slots.find((s) => s.isApprover)?.slot ?? 'approver'} slot.
        Unlocking a report voids all signatures — everyone signs again after edits.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((s) => (
          <div key={s.slot} className={`rounded-lg border p-3 ${s.signedBy ? 'border-green-300 bg-green-50/40' : 'border-stone-200'}`}>
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{s.slot}</div>
            {s.signedBy ? (
              <div className="mt-1">
                {s.imageData ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.imageData} alt={`Signature of ${s.signedBy}`} className="h-12 object-contain" />
                ) : (
                  <div className="h-12 font-serif text-lg italic text-stone-700">{s.signedBy}</div>
                )}
                <div className="text-sm font-medium">{s.signedBy}</div>
                <div className="text-xs text-green-700">
                  ✓ digitally signed {s.signedAt ? new Date(s.signedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                </div>
              </div>
            ) : s.isApprover ? (
              status === 'SUBMITTED' && s.isCurrentStage && canApprove ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={busy} onClick={() => decide('approve')}>
                    Approve &amp; sign
                  </button>
                  <button className="btn-danger" disabled={busy} onClick={() => decide('reject')}>
                    Reject…
                  </button>
                </div>
              ) : status === 'SUBMITTED' && s.isCurrentStage ? (
                <div className="mt-2 text-sm text-amber-600">⏳ waiting for this approval now</div>
              ) : (
                <div className="mt-2 text-sm text-stone-400">signs on approval</div>
              )
            ) : editable ? (
              <button className="btn-secondary mt-2" disabled={busy} onClick={() => sign(s.slot)}>
                Sign as {s.slot}
              </button>
            ) : (
              <div className="mt-2 text-sm text-stone-400">not signed</div>
            )}
          </div>
        ))}
      </div>
      {showPad && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/30 p-3">
          <p className="mb-2 text-sm font-medium">First time — draw your signature (saved to your profile, reused everywhere):</p>
          <SignaturePad onSave={savePadAndSign} saving={padSaving} />
        </div>
      )}
      {error && <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </section>
  );
}
