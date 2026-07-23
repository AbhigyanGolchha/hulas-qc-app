'use client';
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-primary no-print fixed right-4 top-4 shadow-lg">
      Print / Save as PDF
    </button>
  );
}
