'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SignaturePad } from '@/components/signature-pad';

export function ProfileSignature({ current }: { current: string | null }) {
  const router = useRouter();
  const [redraw, setRedraw] = useState(!current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(imageData: string | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/me/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData }),
      });
      if (!res.ok) {
        setError((await res.json()).error || 'Could not save');
        return;
      }
      setRedraw(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {current && !redraw && (
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current} alt="Your saved signature" className="h-20 rounded border border-stone-200 bg-white object-contain px-3" />
          <div className="flex flex-col gap-1.5">
            <button className="btn-secondary" onClick={() => setRedraw(true)}>Draw a new one</button>
            <button className="btn-danger" disabled={saving} onClick={() => save(null)}>Remove</button>
          </div>
        </div>
      )}
      {redraw && <SignaturePad onSave={save} saving={saving} />}
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <p className="text-xs text-stone-400">
        Changing your signature never rewrites old reports — each sign-off keeps a snapshot of the
        signature as it was at signing time.
      </p>
    </div>
  );
}
