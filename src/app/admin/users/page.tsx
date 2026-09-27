// Admin → Users: the only place accounts are created. No self-signup, no
// demo logins. New users and password resets get a one-time temporary
// password (shown here once, emailed if the user has an address) and must
// choose their own password on first sign-in.
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePermission, requestBaseUrl, hashPassword, generateTempPassword, passwordProblem } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { getRoles } from '@/lib/roles';
import { logAudit } from '@/lib/audit';
import { sendAccountMail } from '@/lib/notify';
import { getMailConfig, isMailConfigured } from '@/lib/mail';
import { fmtNpt } from '@/lib/dates';
import { ConfirmButton } from '@/components/confirm-button';
import { openResetRequests } from '@/lib/password-reset';

export const dynamic = 'force-dynamic';

async function guard() {
  const user = await requirePermission('admin.users');
  return user;
}

const go = (q: Record<string, string>) => redirect('/admin/users?' + new URLSearchParams(q).toString());

function cleanEmail(v: FormDataEntryValue | null): string | null {
  const e = String(v || '').trim().toLowerCase();
  if (!e) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('That email address does not look right.');
  return e;
}

async function addUser(formData: FormData) {
  'use server';
  const admin = await guard();
  try {
    const username = String(formData.get('username') || '').trim().toLowerCase();
    const name = String(formData.get('name') || '').trim();
    const role = String(formData.get('role') || 'QC');
    const millId = String(formData.get('millId') || '') || null;
    const email = cleanEmail(formData.get('email'));
    let password = String(formData.get('password') || '').trim();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Username: 3–32 characters, lowercase letters, numbers, dot, dash or underscore.');
    if (!name) throw new Error('Full name is required.');
    if (!(await getRoles()).some((r) => r.key === role)) throw new Error('Unknown role.');
    if (await prisma.user.findUnique({ where: { username } })) throw new Error(`Username "${username}" is already taken.`);
    const generated = !password;
    if (generated) password = generateTempPassword();
    else {
      const p = passwordProblem(password);
      if (p) throw new Error(p);
    }
    const u = await prisma.user.create({ data: { username, name, email, role, millId, passwordHash: hashPassword(password), mustChangePassword: true } });
    await logAudit(admin, 'MASTER', u.id, 'CREATE', 'user', null, `${name} (${username}, ${role}${email ? ', ' + email : ''})`);
    await sendAccountMail(u, 'INVITE', password, admin.name, requestBaseUrl());
    go({ msg: `Account "${username}" created for ${name}.`, temp: password, tempFor: username, mailed: !email ? '0' : isMailConfigured(await getMailConfig()) ? '1' : 'off' });
  } catch (e) {
    if ((e as any)?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    go({ err: (e as Error).message });
  }
}

async function updateUser(formData: FormData) {
  'use server';
  const admin = await guard();
  try {
    const id = String(formData.get('id'));
    const before = await prisma.user.findUniqueOrThrow({ where: { id } });
    const name = String(formData.get('name') || '').trim() || before.name;
    const role = String(formData.get('role') || before.role);
    const millId = String(formData.get('millId') || '') || null;
    const email = cleanEmail(formData.get('email'));
    if (!(await getRoles()).some((r) => r.key === role)) throw new Error('Unknown role.');
    if (before.id === admin.id && role !== 'ADMIN') throw new Error('You cannot remove your own Admin role.');
    await prisma.user.update({ where: { id }, data: { name, role, millId, email } });
    const changes: string[] = [];
    if (before.name !== name) changes.push(`name ${before.name} → ${name}`);
    if (before.role !== role) changes.push(`role ${before.role} → ${role}`);
    if (before.millId !== millId) changes.push('mill changed');
    if (before.email !== email) changes.push(`email ${before.email ?? '∅'} → ${email ?? '∅'}`);
    if (changes.length) await logAudit(admin, 'MASTER', id, 'UPDATE', 'user', null, changes.join('; '));
    go({ msg: `Saved ${name}.` });
  } catch (e) {
    if ((e as any)?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    go({ err: (e as Error).message });
  }
}

async function toggleActive(formData: FormData) {
  'use server';
  const admin = await guard();
  const id = String(formData.get('id'));
  const u = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (u.id === admin.id) go({ err: 'You cannot deactivate yourself.' });
  const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
  if (u.active && u.role === 'ADMIN' && admins <= 1) go({ err: 'That is the last active Admin — create another Admin first.' });
  await prisma.user.update({ where: { id }, data: { active: !u.active, failedLogins: 0, lockedUntil: null } });
  await logAudit(admin, 'MASTER', id, 'UPDATE', 'user.active', String(u.active), String(!u.active));
  go({ msg: `${u.name} ${u.active ? 'deactivated — they can no longer sign in' : 'reactivated'}.` });
}

async function resetPassword(formData: FormData) {
  'use server';
  const admin = await guard();
  const id = String(formData.get('id'));
  const u = await prisma.user.findUniqueOrThrow({ where: { id } });
  const temp = generateTempPassword();
  await prisma.user.update({ where: { id }, data: { passwordHash: hashPassword(temp), mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
  await logAudit(admin, 'AUTH', id, 'PASSWORD_RESET', undefined, null, `by ${admin.name}`);
  await sendAccountMail(u, 'RESET', temp, admin.name, requestBaseUrl());
  go({ msg: `Password reset for ${u.name}. They must choose a new one at next sign-in.`, temp, tempFor: u.username, mailed: !u.email ? '0' : isMailConfigured(await getMailConfig()) ? '1' : 'off' });
}

// Permanent delete: the account and its sign-in history (logins, failed
// logins, password events) are removed. Signatures and report history stay —
// they keep the person's name, only the link to the deleted account is cleared.
async function deleteUser(formData: FormData) {
  'use server';
  const admin = await guard();
  const id = String(formData.get('id'));
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) go({ err: 'That user no longer exists.' });
  if (u!.id === admin.id) go({ err: 'You cannot delete your own account.' });
  if (u!.role === 'ADMIN' && (await prisma.user.count({ where: { role: 'ADMIN', active: true, id: { not: id } } })) === 0) {
    go({ err: 'That is the last active Admin — create another Admin first.' });
  }
  const signIns = await prisma.auditLog.deleteMany({ where: { recordType: 'AUTH', OR: [{ userId: id }, { recordId: id }] } });
  await prisma.auditLog.updateMany({ where: { userId: id }, data: { userId: null } });
  await prisma.signature.updateMany({ where: { userId: id }, data: { userId: null } });
  await prisma.notification.updateMany({ where: { userId: id }, data: { userId: null } });
  await prisma.user.delete({ where: { id } });
  await logAudit(admin, 'MASTER', id, 'DELETE', 'user', `${u!.name} (${u!.username}, ${u!.role})`, `deleted with ${signIns.count} sign-in record(s)`);
  go({ msg: `${u!.name} (${u!.username}) permanently deleted, with ${signIns.count} sign-in record(s). Their signatures on reports stay, with their name.` });
}

async function unlock(formData: FormData) {
  'use server';
  const admin = await guard();
  const id = String(formData.get('id'));
  const u = await prisma.user.findUniqueOrThrow({ where: { id } });
  await prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
  await logAudit(admin, 'AUTH', id, 'UNLOCK_ACCOUNT');
  go({ msg: `${u.name} unlocked.` });
}

export default async function UsersAdmin({ searchParams }: { searchParams: Record<string, string> }) {
  const admin = await guard();
  const roleList = await getRoles();
  const ROLES = roleList.map((r) => r.key);
  const ROLE_LABELS: Record<string, string> = Object.fromEntries(roleList.map((r) => [r.key, r.label]));
  const [users, mills] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { mill: true } }),
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  const now = new Date();
  // "Forgot password?" requests that couldn't be emailed a link — waiting on the Admin
  const resetRequests = await openResetRequests();
  const mailOn = isMailConfigured(await getMailConfig());
  const requesters = users.filter((u) => resetRequests.has(u.id));

  return (
    <Shell user={admin} active="/admin">
      <PageTitle title="Users & sign-in" subtitle="Accounts are created here only. New users get a temporary password and pick their own on first sign-in. 5 wrong passwords lock an account for 15 minutes." />

      {searchParams.msg && <div className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.msg}</div>}
      {searchParams.err && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.err}</div>}
      {searchParams.temp && (
        <div className="mb-4 rounded-lg border-2 border-brand-500 bg-brand-50 px-4 py-3 text-sm">
          <div className="font-semibold text-brand-700">Temporary password for <code>{searchParams.tempFor}</code> — shown only once:</div>
          <div className="my-1 font-mono text-2xl tracking-wide">{searchParams.temp}</div>
          <div className="text-xs text-stone-600">
            {searchParams.mailed === '1' ? 'A welcome email with the login link, username and this password was also sent (delivery status: Admin → Notifications). ' : searchParams.mailed === 'off' ? 'Email is switched off, so NO email was sent — pass this on to them yourself. ' : 'The user has no email address — pass this on to them yourself. '}
            They will be asked to choose their own password the first time they sign in.
          </div>
        </div>
      )}

      {!mailOn && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <b>Email is switched off</b> — welcome emails, password-reset links and all notifications are NOT being sent (they wait in
          Admin → Notifications as &quot;skipped&quot;). Fill in the SMTP settings and switch email on in{' '}
          <a href="/admin/notifications" className="font-medium underline">Admin → Notifications</a>, then press &quot;Send pending&quot;.
        </div>
      )}
      {requesters.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Asked for a password reset ({requesters.length})</div>
          <p className="mb-2 text-xs">These people used &quot;Forgot password?&quot; but have no email address on their account (or email is off), so no link could be sent. Press Reset and give them the temporary password.</p>
          <ul className="space-y-1">
            {requesters.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{u.name}</span> <code className="text-xs">{u.username}</code>
                <span className="text-xs text-amber-700">asked {fmtNpt(resetRequests.get(u.id))}</span>
                <form action={resetPassword}><input type="hidden" name="id" value={u.id} /><button className="btn-secondary !py-0.5 text-xs">Reset password…</button></form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card title="Add a user" className="mb-4">
        <form action={addUser} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-6">
          <label>Full name<br /><input name="name" required className="field" placeholder="Poonam Gupta" /></label>
          <label>Username<br /><input name="username" required className="field" placeholder="poonam" autoCapitalize="none" /></label>
          <label>Email (for notifications)<br /><input name="email" type="email" className="field" placeholder="poonam@hulas.com" /></label>
          <label>Role<br /><select name="role" className="field">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
          <label>Mill (supervisors only)<br /><select name="millId" className="field"><option value="">— all mills —</option>{mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>Temporary password<br /><input name="password" className="field" placeholder="leave blank to generate" autoComplete="off" /></label>
          <div className="lg:col-span-6"><button className="btn-primary">Create account</button></div>
        </form>
      </Card>

      <Card title={`All users (${users.length})`}>
        <div className="space-y-2">
          {users.map((u) => {
            const locked = u.lockedUntil && u.lockedUntil > now;
            return (
              <details key={u.id} className={`rounded-lg border p-3 ${u.active ? 'border-stone-200' : 'border-stone-100 bg-stone-50 opacity-70'}`}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{u.name}</span>
                  <code className="text-xs text-stone-500">{u.username}</code>
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{ROLE_LABELS[u.role] ?? u.role}</span>
                  {u.mill && <span className="text-xs text-stone-500">{u.mill.name}</span>}
                  <span className="text-xs text-stone-400">{u.email ?? 'no email'}</span>
                  {!u.active && <span className="rounded bg-stone-200 px-1.5 py-0.5 text-xs">deactivated</span>}
                  {locked && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">locked until {fmtNpt(u.lockedUntil)}</span>}
                  {resetRequests.has(u.id) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">asked for a password reset</span>}
                  {u.mustChangePassword && u.active && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">temp password — not yet changed</span>}
                  <span className="ml-auto text-xs text-stone-400">last sign-in {fmtNpt(u.lastLoginAt)}</span>
                </summary>
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-stone-100 pt-3 text-sm">
                  <form action={updateUser} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <label className="text-xs">Full name<br /><input name="name" defaultValue={u.name} className="field w-40" /></label>
                    <label className="text-xs">Email<br /><input name="email" type="email" defaultValue={u.email ?? ''} className="field w-52" /></label>
                    <label className="text-xs">Role<br /><select name="role" defaultValue={u.role} className="field w-40">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
                    <label className="text-xs">Mill<br /><select name="millId" defaultValue={u.millId ?? ''} className="field w-40"><option value="">— all mills —</option>{mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
                    <button className="btn-secondary">Save</button>
                  </form>
                  <span className="flex-1" />
                  {locked && <form action={unlock}><input type="hidden" name="id" value={u.id} /><button className="btn-secondary">Unlock now</button></form>}
                  <form action={resetPassword}><input type="hidden" name="id" value={u.id} /><button className="btn-secondary">Reset password…</button></form>
                  {u.id !== admin.id && (
                    <form action={toggleActive}><input type="hidden" name="id" value={u.id} /><button className={u.active ? 'btn-danger' : 'btn-secondary'}>{u.active ? 'Deactivate' : 'Reactivate'}</button></form>
                  )}
                  {u.id !== admin.id && (
                    <form action={deleteUser}>
                      <input type="hidden" name="id" value={u.id} />
                      <ConfirmButton message={`Permanently delete ${u.name} (${u.username}) and their sign-in history? This cannot be undone. Their signatures on reports stay, with their name.`}>Delete…</ConfirmButton>
                    </form>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </Card>
    </Shell>
  );
}
