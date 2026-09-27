import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requestPasswordReset, RESET_MINUTES } from '@/lib/password-reset';

export const dynamic = 'force-dynamic';

// the address the person is using right now — the emailed link must work on the plant LAN too
function currentBaseUrl(): string {
  const h = headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0].trim();
  return `${proto}://${host}`;
}

async function request(formData: FormData) {
  'use server';
  const id = String(formData.get('id') || '');
  await requestPasswordReset(id, currentBaseUrl());
  // same answer whether or not the account exists
  redirect('/forgot-password?sent=1');
}

export default function ForgotPasswordPage({ searchParams }: { searchParams: { sent?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="text-2xl font-bold text-brand-700">Forgot your password?</div>
          <div className="mt-1 text-sm text-stone-500">Hulas Khadya QC</div>
        </div>
        {searchParams.sent ? (
          <div className="space-y-3 text-sm text-stone-700">
            <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-green-800">Request received.</div>
            <p>
              <b>If your account has an email address</b>, a reset link is on its way — open it within {RESET_MINUTES} minutes
              to choose a new password. Check spam if it doesn&apos;t arrive.
            </p>
            <p>
              <b>If it has no email address</b>, the Admin has been told. They will give you a temporary password;
              you then pick your own when you sign in.
            </p>
          </div>
        ) : (
          <form action={request} className="space-y-4">
            <p className="text-sm text-stone-600">Type your username (or the email address on your account).</p>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-stone-700">Username or email</span>
              <input name="id" required autoFocus autoCapitalize="none" autoComplete="username" className="field" />
            </label>
            <button type="submit" className="btn-primary w-full justify-center">Reset my password</button>
          </form>
        )}
        <p className="text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">← Back to sign in</Link></p>
      </div>
    </main>
  );
}
