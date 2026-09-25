'use client';
// Digital sign-off panel shown on every record page. Each slot mirrors a
// signature line on the old paper form and belongs to one role (Admin →
// Approval flow). Submitting signs the submitter's own slot automatically;
// this panel lets the other role-holders co-sign (only they get the button),
// lets a signer take their signature back while the record is still
// editable, and shows everyone what's signed. Approver slots fill only via Approve.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SignaturePad } from './signature-pad';
import { flushAllAutosaves } from './use-autosave';
import { fmtNpt } from '@/lib/dates';

export type SlotView = {
  slot: string;
  isApprover: boolean;
  isCurrentStage?: boolean; // the approval step this record is waiting on right now
  signerRole?: string | null; // who signs this preparer slot, in words ("Godown Keeper")
  eligibleNames?: string[]; // active users holding that role
  canSign?: boolean; // the viewer holds the slot's role
  signedBy: string | null;
  signedById?: string | null;
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
  currentUserId,
  canRemoveAny = false,
}: {
  type: 'intake' | 'qc' | 'production';
  id: string;
  status: string;
  slots: SlotView[];
  userHasSignature: boolean;
  canApprove?: boolean;
  currentUserId?: string;
  canRemoveAny?: boolean; // Manager/Admin may remove anyone's preparer signature
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPad, setShowPad] = useState(false);
  const [padSaving, setPadSaving] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const editable = ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(status);

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/records/${type}/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

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
      await post({ action: 'sign', slot });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unsign(slot: string, who: string) {
    if (!window.confirm(`Remove the signature of ${who} from "${slot}"? The slot can be signed again afterwards.`)) return;
    setBusy(true);
    setError(null);
    try {
      await post({ action: 'unsign', slot });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
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
      await flushAllAutosaves(); // e.g. a Decision picked a second ago must be saved before approving
      await post({ action, reason });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
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
        try {
          await post({ action: 'sign', slot: pendingSlot });
        } catch (e) {
          setError((e as Error).message);
        }
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
        Each slot can only be signed by the role shown on it. Submitting signs your own slot automatically.
        Approving signs the {slots.find((s) => s.isApprover)?.slot ?? 'approver'} slot.
        While a report is still editable you can take your signature back and sign again (each change is audited).
        Unlocking an approved report voids all signatures — everyone signs again after edits.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((s) => {
          const mine = Boolean(currentUserId && s.signedById === currentUserId);
          const mayRemove = editable && !s.isApprover && s.signedBy && (mine || canRemoveAny);
          return (
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
                  <div className="text-xs text-green-700">✓ digitally signed {fmtNpt(s.signedAt)}</div>
                  {mayRemove && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {mine && (
                        <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => sign(s.slot)} title="Stamp again with your current saved signature">
                          Sign again
                        </button>
                      )}
                      <button className="btn-danger !px-2 !py-1 text-xs" disabled={busy} onClick={() => unsign(s.slot, s.signedBy!)}>
                        {mine ? 'Remove my signature' : 'Remove signature'}
                      </button>
                    </div>
                  )}
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
              ) : editable && s.canSign ? (
                <button className="btn-secondary mt-2" disabled={busy} onClick={() => sign(s.slot)}>
                  Sign as {s.slot}
                </button>
              ) : (
                <div className="mt-2 text-sm text-stone-400">
                  {editable ? 'waiting for signature' : 'not signed'}
                  {s.signerRole && (
                    <div className="text-xs">
                      signed by: {s.signerRole}
                      {s.eligibleNames && s.eligibleNames.length > 0 && <> ({s.eligibleNames.join(', ')})</>}
                      {s.eligibleNames && s.eligibleNames.length === 0 && s.signerRole !== 'anyone who can edit the report' && <> — no active user has this role yet</>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showPad && (
        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/30 p-3">
          <p className="mb-2 text-sm font-medium">First time — draw your signature (saved to your profile, reused everywhere):</p>
          <SignaturePad onSave={savePadAndSign} saving={padSaving} draftKey={`sig:${currentUserId ?? 'me'}`} />
        </div>
      )}
      {error && <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </section>
  );
}
