import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MIN_PASSWORD } from '@/lib/auth';
import { checkResetToken, completePasswordReset } from '@/lib/password-reset';

export const dynamic = 'force-dynamic';

async function setPassword(formData: FormData) {
  'use server';
  const token = String(formData.get('token') || '');
  const err = await completePasswordReset(token, String(formData.get('password') || ''), String(formData.get('password2') || ''));
  if (err) redirect(`/reset-password?token=${encodeURIComponent(token)}&err=${encodeURIComponent(err)}`);
  redirect('/login?reset=1');
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: { token?: string; err?: string } }) {
  const user = await checkResetToken(searchParams.token);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="text-2xl font-bold text-brand-700">Choose a new password</div>
          <div className="mt-1 text-sm text-stone-500">Hulas Khadya QC</div>
        </div>
        {!user ? (
          <div className="space-y-3 text-sm">
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              This reset link is no longer valid — it expired or was already used.
            </div>
            <p className="text-center"><Link href="/forgot-password" className="text-brand-700 hover:underline">Ask for a new link</Link></p>
          </div>
        ) : (
          <form action={setPassword} className="space-y-4">
            {searchParams.err && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.err}</div>}
            <p className="text-sm text-stone-600">For <b>{user.name}</b> (username <code>{user.username}</code>).</p>
            <input type="hidden" name="token" value={searchParams.token} />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">New password</span>
              <input name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className="field" autoFocus />
              <span className="mt-1 block text-xs text-stone-400">At least {MIN_PASSWORD} characters, with letters and at least one number.</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">New password again</span>
              <input name="password2" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className="field" />
            </label>
            <button type="submit" className="btn-primary w-full justify-center">Save new password</button>
          </form>
        )}
        <p className="text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">← Back to sign in</Link></p>
      </div>
    </main>
  );
}
