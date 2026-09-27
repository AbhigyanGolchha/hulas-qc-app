'use client';
// Submit button that asks "are you sure?" first — for irreversible actions.
export function ConfirmButton({ children, message, className = 'btn-danger' }: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
