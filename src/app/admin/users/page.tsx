// Admin → Users: the only place accounts are created. No self-signup, no
// demo logins. New users and password resets get a one-time temporary
// password (shown here once, emailed if the user has an address) and must
// choose their own password on first sign-in.
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser, hashPassword, generateTempPassword, passwordProblem } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { ROLES, ROLE_LABELS } from '@/lib/constants';
import { logAudit } from '@/lib/audit';
import { sendAccountMail } from '@/lib/notify';
import { fmtNpt } from '@/lib/dates';

export const dynamic = 'force-dynamic';

async function guard() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') redirect('/admin');
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
    if (!(ROLES as readonly string[]).includes(role)) throw new Error('Unknown role.');
    if (await prisma.user.findUnique({ where: { username } })) throw new Error(`Username "${username}" is already taken.`);
    const generated = !password;
    if (generated) password = generateTempPassword();
    else {
      const p = passwordProblem(password);
      if (p) throw new Error(p);
    }
    const u = await prisma.user.create({ data: { username, name, email, role, millId, passwordHash: hashPassword(password), mustChangePassword: true } });
    await logAudit(admin, 'MASTER', u.id, 'CREATE', 'user', null, `${name} (${username}, ${role}${email ? ', ' + email : ''})`);
    await sendAccountMail(u, 'INVITE', password, admin.name);
    go({ msg: `Account "${username}" created for ${name}.`, temp: password, tempFor: username, mailed: email ? '1' : '0' });
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
  await sendAccountMail(u, 'RESET', temp, admin.name);
  go({ msg: `Password reset for ${u.name}. They must choose a new one at next sign-in.`, temp, tempFor: u.username, mailed: u.email ? '1' : '0' });
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
  const [users, mills] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { mill: true } }),
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  const now = new Date();

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
            {searchParams.mailed === '1' ? 'Also emailed to the user (see Admin → Notifications for delivery status). ' : 'The user has no email address — pass this on to them yourself. '}
            They will be asked to choose their own password the first time they sign in.
          </div>
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
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}</span>
                  {u.mill && <span className="text-xs text-stone-500">{u.mill.name}</span>}
                  <span className="text-xs text-stone-400">{u.email ?? 'no email'}</span>
                  {!u.active && <span className="rounded bg-stone-200 px-1.5 py-0.5 text-xs">deactivated</span>}
                  {locked && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">locked until {fmtNpt(u.lockedUntil)}</span>}
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
                </div>
              </details>
            );
          })}
        </div>
      </Card>
    </Shell>
  );
}
