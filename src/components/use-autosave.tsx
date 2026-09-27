'use client';
// Debounced autosave: call notify() whenever state changes; the latest
// snapshot is PATCHed after 1.2s of quiet. Exposes save state for the UI.
// flushAllAutosaves() lets other widgets on the page (the sign-off panel's
// Approve button) make sure every pending edit is on the server first.
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const registry = new Set<() => Promise<void>>();
export async function flushAllAutosaves() {
  await Promise.all([...registry].map((f) => f()));
}

export function useAutosave<T>(url: string, enabled: boolean) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // wait for a save already on the wire, then send whatever arrived meanwhile
    while (inflight.current) await inflight.current;
    if (!latest.current) return;
    const payload = latest.current;
    latest.current = null;
    setState('saving');
    const run = (async () => {
      try {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          let msg = '';
          try {
            msg = (await res.json()).error ?? '';
          } catch {
            // non-JSON error body
          }
          throw new Error(msg);
        }
        setError(null);
        setState(latest.current ? 'dirty' : 'saved');
      } catch (e) {
        setError((e as Error).message || null);
        setState('error');
      }
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
    if (latest.current) await flush(); // a newer snapshot arrived while saving
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

  // flush on unmount / page hide; register for flushAllAutosaves()
  useEffect(() => {
    registry.add(flush);
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      registry.delete(flush);
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [flush]);

  return { saveState: state, saveError: error, notify, flushNow: flush };
}

export function SaveIndicator({ state, error }: { state: SaveState; error?: string | null }) {
  const map: Record<SaveState, [string, string]> = {
    idle: ['', 'text-stone-400'],
    dirty: ['Unsaved changes…', 'text-amber-600'],
    saving: ['Saving…', 'text-amber-600'],
    saved: ['All changes saved', 'text-green-600'],
    error: ['Save failed — will retry on next change', 'text-red-600'],
  };
  const [label, cls] = map[state];
  return <span className={`text-xs ${cls}`}>{state === 'error' && error ? `Not saved: ${error}` : label}</span>;
}
