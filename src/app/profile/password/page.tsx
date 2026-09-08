import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, verifyPassword, hashPassword, passwordProblem, MIN_PASSWORD } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function changePassword(formData: FormData) {
  'use server';
  const user = await requireUser({ allowPasswordChange: true });
  const current = String(formData.get('current') || '');
  const pw = String(formData.get('password') || '');
  const pw2 = String(formData.get('password2') || '');
  const first = formData.get('first') === '1';
  const back = (err: string) => redirect(`/profile/password?${first ? 'first=1&' : ''}err=${encodeURIComponent(err)}`);
  const db = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!verifyPassword(current, db.passwordHash)) back('Your current password is wrong.');
  if (pw !== pw2) back('The two new passwords do not match.');
  const problem = passwordProblem(pw);
  if (problem) back(problem);
  if (verifyPassword(pw, db.passwordHash)) back('The new password must be different from the current one.');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(pw), mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
  await logAudit(user, 'AUTH', user.id, 'PASSWORD_CHANGED');
  redirect('/profile?ok=1');
}

export default async function PasswordPage({ searchParams }: { searchParams: { first?: string; err?: string } }) {
  const user = await requireUser({ allowPasswordChange: true });
  const first = searchParams.first === '1' || user.mustChangePassword;
  return (
    <Shell user={user} active="/profile">
      <PageTitle title={first ? 'Choose your password' : 'Change password'} subtitle={first ? 'Your account was set up with a temporary password. Pick your own before continuing.' : undefined} />
      {searchParams.err && <div className="mb-4 max-w-md rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.err}</div>}
      <Card className="max-w-md">
        <form action={changePassword} className="space-y-3 text-sm">
          <input type="hidden" name="first" value={first ? '1' : '0'} />
          <label className="block">
            <span className="mb-1 block font-medium text-stone-700">{first ? 'Temporary password (the one you just used)' : 'Current password'}</span>
            <input name="current" type="password" required autoComplete="current-password" className="field" autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-stone-700">New password</span>
            <input name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className="field" />
            <span className="mt-1 block text-xs text-stone-400">At least {MIN_PASSWORD} characters, with letters and at least one number.</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-stone-700">New password again</span>
            <input name="password2" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className="field" />
          </label>
          <button className="btn-primary">Save password</button>
        </form>
      </Card>
    </Shell>
  );
}
