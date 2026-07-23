export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl bg-white p-6 font-serif text-[13px] leading-snug text-black print:p-0">
      {children}
    </div>
  );
}
