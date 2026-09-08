import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@/lib/auth';
import { clearSessionCookie } from '@/lib/auth';
import { ROLE_LABELS, type Role } from '@/lib/constants';

async function logout() {
  'use server';
  const { getSessionUser } = await import('@/lib/auth');
  const { prisma } = await import('@/lib/db');
  const u = await getSessionUser();
  if (u) await prisma.auditLog.create({ data: { userId: u.id, userName: u.name, recordType: 'AUTH', recordId: u.id, action: 'LOGOUT' } });
  clearSessionCookie();
  redirect('/login?out=1');
}

const NAV = [
  { href: '/', label: 'Home', roles: null },
  { href: '/intake', label: 'Raw Material Intake', roles: null },
  { href: '/qc', label: 'Product QC', roles: null },
  { href: '/production', label: 'Daily Production', roles: null },
  { href: '/reports/weekly', label: 'Weekly Report', roles: null },
  { href: '/batches', label: 'Batches', roles: null },
  { href: '/admin', label: 'Admin', roles: ['ADMIN', 'MANAGER'] },
];

export function Shell({ user, active, children }: { user: SessionUser; active: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-20 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <Link href="/" className="text-base font-bold text-brand-700">Hulas Khadya QC</Link>
          <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
            {NAV.filter((n) => !n.roles || n.roles.includes(user.role)).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded px-2.5 py-1.5 ${active === n.href ? 'bg-brand-50 font-semibold text-brand-700' : 'text-stone-600 hover:bg-stone-100'}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/profile" className="hidden text-stone-500 underline-offset-2 hover:text-brand-700 hover:underline sm:inline" title="My profile & signature">
              {user.name} · {ROLE_LABELS[user.role as Role] ?? user.role}
            </Link>
            <form action={logout}>
              <button className="text-stone-400 underline-offset-2 hover:text-stone-700 hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
