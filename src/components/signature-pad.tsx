'use client';
// Canvas signature pad — mouse + touch (tablet at the intake gate). Exports a
// PNG data URI via onSave.
//
// A signature stroke is exactly the gesture browsers hijack: a horizontal
// swipe is "go back", a downward pull at the top is "refresh" (Chrome Android),
// an edge-start stroke is the system back gesture on iOS/Android. globals.css
// turns off overscroll navigation where the browser allows it; for the rest,
// the drawing is kept in sessionStorage after every stroke and restored when
// the pad comes back, so a lost page never means a lost signature.
import { useEffect, useRef, useState } from 'react';

export function SignaturePad({
  onSave,
  saving,
  height = 180,
  draftKey = 'signature-draft',
}: {
  onSave: (dataUri: string) => void;
  saving?: boolean;
  height?: number;
  draftKey?: string; // per-user key so a shared tablet never restores someone else's draft
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [restored, setRestored] = useState(false);
  const storageKey = `hulas:${draftKey}`;

  function readDraft(): string | null {
    try { return sessionStorage.getItem(storageKey); } catch { return null; }
  }
  function writeDraft(dataUri: string | null) {
    try {
      if (dataUri) sessionStorage.setItem(storageKey, dataUri);
      else sessionStorage.removeItem(storageKey);
    } catch { /* storage blocked — drawing still works, just without the safety net */ }
  }

  // size the bitmap to the CSS box × device pixels; repaint an existing image
  // (draft or previous size) so a resize never wipes the strokes
  function setup(imageToRestore?: string | null) {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1c1917';
    if (imageToRestore) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        setHasInk(true);
      };
      img.src = imageToRestore;
    }
  }

  useEffect(() => {
    const draft = readDraft();
    setup(draft);
    if (draft) setRestored(true);
    const onResize = () => setup(canvasRef.current?.toDataURL('image/png'));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a reload/close with unsaved ink gets the browser's "leave page?" prompt
  useEffect(() => {
    if (!hasInk) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasInk]);

  function pos(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent) {
    e.preventDefault();
    try { canvasRef.current!.setPointerCapture(e.pointerId); } catch { /* some stylus drivers report ids the canvas can't capture — drawing still works */ }
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // a dot for taps
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setHasInk(true);
    setRestored(false);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    writeDraft(canvasRef.current!.toDataURL('image/png'));
  }
  function clear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setRestored(false);
    writeDraft(null);
  }
  function save() {
    if (!hasInk) return;
    writeDraft(null);
    onSave(canvasRef.current!.toDataURL('image/png'));
  }

  return (
    <div className="space-y-2">
      {restored && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Your unsaved drawing from before was restored — press <b>Save signature</b> to keep it, or Clear to start again.
        </div>
      )}
      {/* the padding keeps strokes away from the screen edge, where tablets start their back gesture */}
      <div className="px-2 sm:px-0">
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: 'none', overscrollBehavior: 'none' }}
          className="w-full cursor-crosshair rounded-lg border-2 border-dashed border-stone-300 bg-white select-none"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={!hasInk || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save signature'}
        </button>
        <button type="button" className="btn-secondary" disabled={!hasInk || saving} onClick={clear}>
          Clear
        </button>
        <span className="text-xs text-stone-400">Draw with mouse, finger or stylus — start away from the screen edge. Nothing is saved until you press Save.</span>
      </div>
    </div>
  );
}
