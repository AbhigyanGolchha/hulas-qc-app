// Admin → Roles & permissions. Roles are data: create them, rename them, tick
// what each may do. Users get a role on Admin → Users; the approval matrix
// picks roles for sign-off slots, approval steps and unlocking.
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { logAudit } from '@/lib/audit';
import { PERMISSIONS, SUPER_ROLE, getRoles, saveRoles, roleSet } from '@/lib/roles';
import { getPreparerSlots } from '@/lib/sign';
import { getUnlockRoles } from '@/lib/approval';

export const dynamic = 'force-dynamic';

const go = (q: Record<string, string>) => redirect('/admin/roles?' + new URLSearchParams(q).toString());

async function addRole(formData: FormData) {
  'use server';
  const user = await requirePermission('admin.users');
  const label = String(formData.get('label') || '').trim();
  if (!label) go({ err: 'The role needs a name.' });
  const key = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  const roles = await getRoles();
  if (!key || roles.some((r) => r.key === key || r.label.toLowerCase() === label.toLowerCase())) go({ err: `A role called "${label}" already exists.` });
  const permissions = Object.keys(PERMISSIONS).filter((p) => formData.get(`p_${p}`) === 'on');
  await saveRoles([...roles, { key, label, permissions }]);
  await logAudit(user, 'MASTER', key, 'CREATE', 'role', null, `${label}: ${permissions.join(', ') || 'no permissions'}`);
  go({ msg: `Role "${label}" created. Give it to people on Admin → Users, and use it in the Approval matrix.` });
}

async function updateRole(formData: FormData) {
  'use server';
  const user = await requirePermission('admin.users');
  const key = String(formData.get('key'));
  if (key === SUPER_ROLE) go({ err: 'The Admin role always has every permission and cannot be changed.' });
  const roles = await getRoles();
  const before = roles.find((r) => r.key === key);
  if (!before) go({ err: 'Unknown role.' });
  const label = String(formData.get('label') || '').trim() || before!.label;
  const permissions = Object.keys(PERMISSIONS).filter((p) => formData.get(`p_${p}`) === 'on');
  await saveRoles(roles.map((r) => (r.key === key ? { ...r, label, permissions } : r)));
  await logAudit(user, 'MASTER', key, 'UPDATE', 'role', `${before!.label}: ${before!.permissions.join(', ')}`, `${label}: ${permissions.join(', ')}`);
  go({ msg: `Role "${label}" saved.` });
}

async function deleteRole(formData: FormData) {
  'use server';
  const user = await requirePermission('admin.users');
  const key = String(formData.get('key'));
  if (key === SUPER_ROLE) go({ err: 'The Admin role cannot be deleted.' });
  const roles = await getRoles();
  const role = roles.find((r) => r.key === key);
  if (!role) go({ err: 'Unknown role.' });
  // never leave people or the approval matrix pointing at a role that is gone
  const users = await prisma.user.count({ where: { role: key } });
  if (users) go({ err: `"${role!.label}" is still given to ${users} user(s) — move them to another role first (Admin → Users).` });
  const kinds = ['intake', 'qc', 'production'] as const;
  const inMatrix =
    (await prisma.approvalStage.findMany()).some((s) => roleSet(s.role).includes(key)) ||
    (await Promise.all(kinds.map(getPreparerSlots))).flat().some((s) => roleSet(s.role).includes(key)) ||
    (await Promise.all(kinds.map(getUnlockRoles))).flat().includes(key);
  if (inMatrix) go({ err: `"${role!.label}" is used in the Approval matrix — replace it there first.` });
  await saveRoles(roles.filter((r) => r.key !== key));
  await logAudit(user, 'MASTER', key, 'UPDATE', 'role', role!.label, 'deleted');
  go({ msg: `Role "${role!.label}" deleted.` });
}

export default async function RolesAdmin({ searchParams }: { searchParams: { msg?: string; err?: string } }) {
  const user = await requirePermission('admin.users');
  const roles = await getRoles();
  const counts = Object.fromEntries((await prisma.user.groupBy({ by: ['role'], _count: true, where: { active: true } })).map((g) => [g.role, g._count]));
  const groups = [...new Set(Object.values(PERMISSIONS).map((p) => p.group))];

  const PermBoxes = ({ have, locked = false }: { have: string[]; locked?: boolean }) => (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{g}</div>
          {Object.entries(PERMISSIONS).filter(([, p]) => p.group === g).map(([k, p]) => (
            <label key={k} className="flex items-start gap-2 py-0.5 text-sm">
              <input type="checkbox" name={`p_${k}`} defaultChecked={have.includes(k)} disabled={locked} className="mt-1" />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <Shell user={user} active="/admin">
      <PageTitle
        title="Roles & permissions"
        subtitle="Create roles and choose what each may do. Who signs or approves which report is set per role in the Approval matrix. The Admin role always has everything, so nobody can be locked out."
      />
      {searchParams.msg && <div className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.msg}</div>}
      {searchParams.err && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.err}</div>}

      <div className="space-y-3">
        {roles.map((r) => (
          <details key={r.key} className="rounded-xl border border-stone-200 bg-white p-4">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className="font-semibold">{r.label}</span>
              <span className="text-xs text-stone-500">{counts[r.key] ?? 0} active user(s)</span>
              <span className="text-xs text-stone-400">
                {r.key === SUPER_ROLE ? 'everything (fixed)' : `${r.permissions.length} of ${Object.keys(PERMISSIONS).length} permissions`}
              </span>
            </summary>
            <div className="mt-3 border-t border-stone-100 pt-3">
              {r.key === SUPER_ROLE ? (
                <>
                  <p className="mb-2 text-sm text-stone-500">The Admin role always has every permission — it can&apos;t be edited or deleted.</p>
                  <PermBoxes have={r.permissions} locked />
                </>
              ) : (
                <>
                  <form action={updateRole} className="space-y-3">
                    <input type="hidden" name="key" value={r.key} />
                    <label className="block text-sm">Role name<br /><input name="label" defaultValue={r.label} className="field max-w-xs" /></label>
                    <PermBoxes have={r.permissions} />
                    <button className="btn-primary">Save role</button>
                  </form>
                  <form action={deleteRole} className="mt-3">
                    <input type="hidden" name="key" value={r.key} />
                    <button className="text-xs text-red-600 hover:underline">Delete this role…</button>
                  </form>
                </>
              )}
            </div>
          </details>
        ))}
      </div>

      <Card title="Add a role" className="mt-4">
        <form action={addRole} className="space-y-3">
          <label className="block text-sm">Role name<br /><input name="label" required className="field max-w-xs" placeholder="e.g. Plant Head" /></label>
          <PermBoxes have={['intake.edit', 'qc.edit', 'production.edit']} />
          <button className="btn-primary">Create role</button>
        </form>
      </Card>
    </Shell>
  );
}
