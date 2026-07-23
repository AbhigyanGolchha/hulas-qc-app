import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser, setSessionCookie, verifyPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function login(formData: FormData) {
  'use server';
  const username = String(formData.get('username') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    redirect('/login?error=1');
  }
  setSessionCookie(user.id);
  redirect('/');
}

export default async function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await getSessionUser();
  if (user) redirect('/');
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="text-2xl font-bold text-brand-700">Hulas Khadya Udyog</div>
          <div className="mt-1 text-sm text-stone-500">QC & Daily Production Reporting</div>
        </div>
        {searchParams.error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Wrong username or password. Try again.
          </div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-stone-700">Username</span>
          <input name="username" required autoFocus autoCapitalize="none" className="field" placeholder="e.g. poonam" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-stone-700">Password</span>
          <input name="password" type="password" required className="field" />
        </label>
        <button type="submit" className="btn-primary w-full justify-center">Sign in</button>
        <p className="text-center text-xs text-stone-400">
          Demo logins: admin · poonam · gm · godown · sup.rfm — password <code>hulas123</code>
        </p>
      </form>
    </main>
  );
}
