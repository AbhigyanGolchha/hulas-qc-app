'use client';
// Canvas signature pad — mouse + touch (tablet at the intake gate). Exports a
// trimmed PNG data URI via onSave.
import { useEffect, useRef, useState } from 'react';

export function SignaturePad({
  onSave,
  saving,
  height = 160,
}: {
  onSave: (dataUri: string) => void;
  saving?: boolean;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1c1917';
  }, []);

  function pos(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent) {
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // a dot for taps
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setHasInk(true);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function up() {
    drawing.current = false;
  }
  function clear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }
  function save() {
    if (!hasInk) return;
    onSave(canvasRef.current!.toDataURL('image/png'));
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        style={{ height, touchAction: 'none' }}
        className="w-full cursor-crosshair rounded-lg border-2 border-dashed border-stone-300 bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary" disabled={!hasInk || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save signature'}
        </button>
        <button type="button" className="btn-secondary" disabled={!hasInk || saving} onClick={clear}>
          Clear
        </button>
        <span className="text-xs text-stone-400">Draw with mouse, finger or stylus</span>
      </div>
    </div>
  );
}
