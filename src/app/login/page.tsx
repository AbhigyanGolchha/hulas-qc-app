import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser, loginWithPassword, setSessionCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function login(formData: FormData) {
  'use server';
  const username = String(formData.get('username') || '');
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/');
  const r = await loginWithPassword(username, password);
  if (!r.ok) {
    const q = r.reason === 'locked' ? `locked=${r.minutesLeft ?? 15}` : r.reason === 'inactive' ? 'inactive=1' : 'error=1';
    redirect(`/login?${q}&u=${encodeURIComponent(username.trim().toLowerCase())}`);
  }
  setSessionCookie(r.userId);
  // only ever return to a path inside this app (never an absolute URL someone pasted into ?next=)
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  redirect(r.mustChangePassword ? '/profile/password?first=1' : safeNext);
}

export default async function LoginPage({ searchParams }: { searchParams: { error?: string; locked?: string; inactive?: string; u?: string; next?: string; out?: string; reset?: string } }) {
  const user = await getSessionUser();
  const next = searchParams.next && searchParams.next.startsWith('/') && !searchParams.next.startsWith('//') ? searchParams.next : '/';
  // already signed in (e.g. a stale link to /login): go where they were heading
  if (user) redirect(user.mustChangePassword ? '/profile/password?first=1' : next);
  const bounced = Boolean(searchParams.next) && !searchParams.error && !searchParams.locked && !searchParams.inactive && !searchParams.out && !searchParams.reset;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hku-logo.png" alt="" className="mx-auto mb-2 h-16 w-auto" />
          <div className="text-2xl font-bold text-brand-700">Hulas Khadya Udhyog</div>
          <div className="mt-1 text-sm text-stone-500">QC & Daily Production Reporting</div>
        </div>
        {searchParams.out && (
          <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">You have been signed out.</div>
        )}
        {searchParams.reset && (
          <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">Password changed. Sign in with your new password.</div>
        )}
        {bounced && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your session has ended (signed out, expired, or the browser dropped its cookie). Sign in and you&apos;ll be taken straight back to where you were.
          </div>
        )}
        {searchParams.error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Wrong username or password. Try again — after 5 wrong tries the account locks for 15 minutes.
          </div>
        )}
        {searchParams.locked && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Too many wrong attempts. This account is locked for about {searchParams.locked} minute{searchParams.locked === '1' ? '' : 's'}. If you have forgotten it, use <Link href="/forgot-password" className="font-medium underline">Forgot password?</Link> below.
          </div>
        )}
        {searchParams.inactive && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This account has been deactivated. Ask an Admin to reactivate it.
          </div>
        )}
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-stone-700">Username</span>
          <input name="username" required autoFocus autoCapitalize="none" autoComplete="username" className="field" defaultValue={searchParams.u ?? ''} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-stone-700">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="field" />
        </label>
        <div className="-mt-2 text-right text-sm">
          <Link href="/forgot-password" className="text-brand-700 hover:underline">Forgot password?</Link>
        </div>
        <button type="submit" className="btn-primary w-full justify-center">Sign in</button>
        <p className="text-center text-xs text-stone-400">
          No account yet? Ask the Admin — accounts are created in Admin → Users.
        </p>
      </form>
    </main>
  );
}
