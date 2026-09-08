import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { ProfileSignature } from './profile-signature';
import { ROLE_LABELS, type Role } from '@/lib/constants';
import { logAudit } from '@/lib/audit';
import { EVENTS, parsePrefs, type EventKey } from '@/lib/notify';
import { fmtNpt } from '@/lib/dates';

export const dynamic = 'force-dynamic';

async function saveContact(formData: FormData) {
  'use server';
  const user = await requireUser();
  const email = String(formData.get('email') || '').trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect('/profile?err=' + encodeURIComponent('That email address does not look right.'));
  const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const prefs: Record<string, boolean> = {};
  for (const k of Object.keys(EVENTS)) if (formData.get(`ev_${k}`) !== 'on') prefs[k] = false;
  await prisma.user.update({ where: { id: user.id }, data: { email, notifyPrefs: JSON.stringify(prefs) } });
  if (before.email !== email) await logAudit(user, 'MASTER', user.id, 'UPDATE', 'user.email', before.email, email);
  revalidatePath('/profile');
  redirect('/profile?ok=1');
}

export default async function ProfilePage({ searchParams }: { searchParams: { ok?: string; err?: string } }) {
  const user = await requireUser();
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { mill: true } });
  const muted = parsePrefs(dbUser.notifyPrefs);
  return (
    <Shell user={user} active="/profile">
      <PageTitle
        title="My profile"
        subtitle={`${user.name} · ${ROLE_LABELS[user.role as Role] ?? user.role}${dbUser.mill ? ' · ' + dbUser.mill.name : ''} · username ${user.username}`}
      >
        <Link className="btn-secondary" href="/profile/password">Change password</Link>
      </PageTitle>
      {searchParams.ok && <div className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">Saved.</div>}
      {searchParams.err && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.err}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="My signature">
          <p className="mb-3 text-sm text-stone-500">
            Drawn once, used everywhere: every report you submit, sign or approve is stamped with this
            signature plus your name and the exact time. You can replace or remove it any time — reports
            you already signed keep the signature as it was then.
          </p>
          <ProfileSignature current={dbUser.signatureData} userId={user.id} />
        </Card>

        <Card title="Email & notifications">
          <form action={saveContact} className="space-y-4 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium text-stone-700">Email address</span>
              <input name="email" type="email" className="field max-w-sm" defaultValue={dbUser.email ?? ''} placeholder="you@hulas.com" />
              <span className="mt-1 block text-xs text-stone-400">Notifications are emailed here. Leave blank to receive none.</span>
            </label>
            <div>
              <div className="mb-1 font-medium text-stone-700">Which events to email me about</div>
              <div className="space-y-1.5">
                {(Object.keys(EVENTS) as EventKey[]).map((k) => (
                  <label key={k} className="flex items-start gap-2">
                    <input type="checkbox" name={`ev_${k}`} defaultChecked={muted[k] !== false} className="mt-0.5" />
                    <span><span className="font-medium">{EVENTS[k].label}</span><br /><span className="text-xs text-stone-400">{EVENTS[k].hint}</span></span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-stone-400">You only receive events that Admin has routed to your role, or that concern reports you prepared or signed.</p>
            </div>
            <button className="btn-primary">Save</button>
          </form>
        </Card>

        <Card title="Account">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-stone-500">Username</dt><dd><code>{user.username}</code></dd>
            <dt className="text-stone-500">Role</dt><dd>{ROLE_LABELS[user.role as Role] ?? user.role}</dd>
            <dt className="text-stone-500">Mill</dt><dd>{dbUser.mill?.name ?? '— (all mills)'}</dd>
            <dt className="text-stone-500">Last sign-in</dt><dd>{fmtNpt(dbUser.lastLoginAt)}</dd>
          </dl>
          <p className="mt-3 text-xs text-stone-400">Times shown in Nepal time (GMT+5:45).</p>
        </Card>
      </div>
    </Shell>
  );
}
