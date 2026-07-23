'use client';
// Debounced autosave: call notify() whenever state changes; the latest
// snapshot is PATCHed after 1.2s of quiet. Exposes save state for the UI.
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function useAutosave<T>(url: string, enabled: boolean) {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T | null>(null);
  const inflight = useRef(false);

  const flush = useCallback(async () => {
    if (!latest.current || inflight.current) return;
    const payload = latest.current;
    latest.current = null;
    inflight.current = true;
    setState('saving');
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setState(latest.current ? 'dirty' : 'saved');
    } catch {
      setState('error');
    } finally {
      inflight.current = false;
      if (latest.current) void flush(); // a newer snapshot arrived while saving
    }
  }, [url]);

  const notify = useCallback(
    (snapshot: T) => {
      if (!enabled) return;
      latest.current = snapshot;
      setState('dirty');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 1200);
    },
    [enabled, flush],
  );

  // flush on unmount / page hide
  useEffect(() => {
    const onHide = () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [flush]);

  return { saveState: state, notify, flushNow: flush };
}

export function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, [string, string]> = {
    idle: ['', 'text-stone-400'],
    dirty: ['Unsaved changes…', 'text-amber-600'],
    saving: ['Saving…', 'text-amber-600'],
    saved: ['All changes saved', 'text-green-600'],
    error: ['Save failed — will retry on next change', 'text-red-600'],
  };
  const [label, cls] = map[state];
  return <span className={`text-xs ${cls}`}>{label}</span>;
}
