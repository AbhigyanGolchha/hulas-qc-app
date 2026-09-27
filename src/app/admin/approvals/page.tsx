import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { logAudit } from '@/lib/audit';
import { getRoles, roleListLabel, roleSet } from '@/lib/roles';
import { getPreparerSlots, savePreparerSlots, type RecordKind } from '@/lib/sign';
import { getUnlockRoles, setUnlockRoles, adminOverride, setAdminOverride } from '@/lib/approval';

export const dynamic = 'force-dynamic';

const TYPES = [
  { key: 'INTAKE', kind: 'intake' as const, label: 'Raw Material Intake (spot analysis)' },
  { key: 'QC', kind: 'qc' as const, label: 'Finished Product QC' },
  { key: 'PRODUCTION', kind: 'production' as const, label: 'Daily Production' },
];


async function guard() {
  const user = await requirePermission('admin.matrix');
  return user;
}

// several roles may share a slot or step — stored as "QC,MANAGER"
function pickedRoles(formData: FormData, allowAny: boolean): string {
  const picked = formData.getAll('roles').map(String).filter(Boolean);
  if (allowAny && picked.includes('ANY')) return 'ANY';
  return picked.filter((r) => r !== 'ANY').join(',');
}

// ---- sign-off slots (signed before approval, each bound to its roles) ----

async function addSlot(formData: FormData) {
  'use server';
  const user = await guard();
  const kind = String(formData.get('kind')) as RecordKind;
  const title = String(formData.get('title') || '').trim();
  const role = pickedRoles(formData, true);
  if (!title) redirect('/admin/approvals?err=' + encodeURIComponent('The sign-off slot needs a title (it prints under the signature).'));
  if (!role) redirect('/admin/approvals?err=' + encodeURIComponent('Tick at least one role who may sign the slot.'));
  const slots = await getPreparerSlots(kind);
  const stages = await prisma.approvalStage.findMany({ where: { recordType: kind.toUpperCase() } });
  if (slots.some((x) => x.title.toLowerCase() === title.toLowerCase()) || stages.some((x) => x.title.toLowerCase() === title.toLowerCase())) {
    redirect('/admin/approvals?err=' + encodeURIComponent(`"${title}" is already a signature slot on this report.`));
  }
  await savePreparerSlots(kind, [...slots, { title, role }]);
  await logAudit(user, 'MASTER', kind.toUpperCase(), 'CREATE', 'signoff-slot', null, `${title} (${role})`);
  redirect('/admin/approvals?msg=' + encodeURIComponent(`Sign-off slot "${title}" added — only ${await roleListLabel(role)} can sign it.`));
}

async function updateSlot(formData: FormData) {
  'use server';
  const user = await guard();
  const kind = String(formData.get('kind')) as RecordKind;
  const title = String(formData.get('title'));
  const op = String(formData.get('op'));
  const slots = await getPreparerSlots(kind);
  const i = slots.findIndex((x) => x.title === title);
  if (i < 0) redirect('/admin/approvals');
  if (op === 'remove') {
    await savePreparerSlots(kind, slots.filter((_, x) => x !== i));
    await logAudit(user, 'MASTER', kind.toUpperCase(), 'UPDATE', 'signoff-slot', `${title} (${slots[i].role})`, 'removed');
    redirect('/admin/approvals?msg=' + encodeURIComponent(`Sign-off slot "${title}" removed. Signatures already on reports stay on them.`));
  }
  if (op === 'role') {
    const role = pickedRoles(formData, true);
    if (!role) redirect('/admin/approvals?err=' + encodeURIComponent('Tick at least one role who may sign the slot.'));
    const next = slots.map((x, idx) => (idx === i ? { ...x, role } : x));
    await savePreparerSlots(kind, next);
    await logAudit(user, 'MASTER', kind.toUpperCase(), 'UPDATE', 'signoff-slot', `${title} (${slots[i].role})`, `${title} (${role})`);
  }
  if (op === 'up' || op === 'down') {
    const j = op === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < slots.length) {
      const next = [...slots];
      [next[i], next[j]] = [next[j], next[i]];
      await savePreparerSlots(kind, next);
    }
  }
  redirect('/admin/approvals');
}

async function saveUnlock(formData: FormData) {
  'use server';
  const user = await guard();
  const kind = String(formData.get('kind')) as RecordKind;
  const roles = (await getRoles()).map((r) => r.key).filter((r) => formData.get(`r_${r}`) === 'on');
  const before = await getUnlockRoles(kind);
  await setUnlockRoles(kind, roles);
  await logAudit(user, 'MASTER', kind.toUpperCase(), 'UPDATE', 'unlock-roles', before.join(', ') || '—', roles.join(', ') || '—');
  redirect('/admin/approvals?msg=' + encodeURIComponent('Unlock permissions saved.'));
}

async function saveOverride(formData: FormData) {
  'use server';
  const user = await guard();
  const on = formData.get('on') === '1';
  await setAdminOverride(on);
  await logAudit(user, 'MASTER', 'APPROVAL', 'UPDATE', 'admin-step-in', null, on ? 'on' : 'off');
  redirect('/admin/approvals?msg=' + encodeURIComponent(`Admin step-in switched ${on ? 'ON' : 'OFF'}.`));
}

async function renumber(recordType: string) {
  const rows = await prisma.approvalStage.findMany({ where: { recordType }, orderBy: { order: 'asc' } });
  // two passes so the (recordType, order) unique constraint never collides mid-shuffle
  for (let i = 0; i < rows.length; i++) await prisma.approvalStage.update({ where: { id: rows[i].id }, data: { order: 1000 + i } });
  for (let i = 0; i < rows.length; i++) await prisma.approvalStage.update({ where: { id: rows[i].id }, data: { order: i + 1 } });
}

async function addStage(formData: FormData) {
  'use server';
  const user = await guard();
  const recordType = String(formData.get('recordType'));
  const title = String(formData.get('title') || '').trim();
  const role = pickedRoles(formData, false);
  if (!title) redirect('/admin/approvals?err=' + encodeURIComponent('The approval step needs a title (it becomes the signature slot).'));
  if (!role) redirect('/admin/approvals?err=' + encodeURIComponent('Tick at least one role who may approve the step.'));
  const kind = recordType.toLowerCase() as RecordKind;
  const taken = [...(await getPreparerSlots(kind)).map((x) => x.title), ...(await prisma.approvalStage.findMany({ where: { recordType } })).map((x) => x.title)];
  if (taken.some((t) => t.toLowerCase() === title.toLowerCase())) redirect('/admin/approvals?err=' + encodeURIComponent(`"${title}" is already a signature slot on this report.`));
  const last = await prisma.approvalStage.findFirst({ where: { recordType }, orderBy: { order: 'desc' } });
  await prisma.approvalStage.create({ data: { recordType, order: (last?.order ?? 0) + 1, title, role } });
  await logAudit(user, 'MASTER', recordType, 'CREATE', 'approval-stage', null, `${title} (${role})`);
  redirect('/admin/approvals?msg=' + encodeURIComponent(`Step "${title}" added to ${recordType.toLowerCase()} approvals.`));
}

async function updateStageRoles(formData: FormData) {
  'use server';
  const user = await guard();
  const id = String(formData.get('id'));
  const role = pickedRoles(formData, false);
  if (!role) redirect('/admin/approvals?err=' + encodeURIComponent('Tick at least one role who may approve the step.'));
  const s = await prisma.approvalStage.findUniqueOrThrow({ where: { id } });
  await prisma.approvalStage.update({ where: { id }, data: { role } });
  await logAudit(user, 'MASTER', s.recordType, 'UPDATE', 'approval-stage', `${s.title} (${s.role})`, `${s.title} (${role})`);
  redirect('/admin/approvals?msg=' + encodeURIComponent(`"${s.title}" can now be approved by ${await roleListLabel(role)}.`));
}

async function removeStage(formData: FormData) {
  'use server';
  const user = await guard();
  const id = String(formData.get('id'));
  const s = await prisma.approvalStage.findUniqueOrThrow({ where: { id } });
  if ((await prisma.approvalStage.count({ where: { recordType: s.recordType } })) <= 1) {
    redirect('/admin/approvals?err=' + encodeURIComponent('A report needs at least one approval step — add the new step first, then remove this one.'));
  }
  await prisma.approvalStage.delete({ where: { id } });
  await renumber(s.recordType);
  await logAudit(user, 'MASTER', s.recordType, 'UPDATE', 'approval-stage', `${s.title} (${s.role})`, 'removed');
  redirect('/admin/approvals');
}

async function moveStage(formData: FormData) {
  'use server';
  await guard();
  const id = String(formData.get('id'));
  const dir = String(formData.get('dir'));
  const s = await prisma.approvalStage.findUniqueOrThrow({ where: { id } });
  const neighbor = await prisma.approvalStage.findFirst({
    where: { recordType: s.recordType, order: dir === 'up' ? { lt: s.order } : { gt: s.order } },
    orderBy: { order: dir === 'up' ? 'desc' : 'asc' },
  });
  if (neighbor) {
    // swap via a parking value so the unique constraint stays happy
    await prisma.approvalStage.update({ where: { id: s.id }, data: { order: 9999 } });
    const a = neighbor.order;
    await prisma.approvalStage.update({ where: { id: neighbor.id }, data: { order: s.order } });
    await prisma.approvalStage.update({ where: { id: s.id }, data: { order: a } });
  }
  redirect('/admin/approvals');
}

export default async function ApprovalsAdmin({ searchParams }: { searchParams: { msg?: string; err?: string } }) {
  const user = await guard();
  const roleList = await getRoles();
  const ROLES = roleList.map((r) => r.key);
  const ROLE_LABELS: Record<string, string> = Object.fromEntries(roleList.map((r) => [r.key, r.label]));
  const labelOf = (v: string) => (roleSet(v).includes('ANY') ? 'anyone editing the report' : roleSet(v).map((k) => ROLE_LABELS[k] ?? k).join(' or '));
  const RoleChecks = ({ selected, allowAny }: { selected: string; allowAny: boolean }) => (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {allowAny && <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="roles" value="ANY" defaultChecked={roleSet(selected).includes('ANY')} /> Anyone editing</label>}
      {ROLES.map((r) => (
        <label key={r} className="flex items-center gap-1 text-xs"><input type="checkbox" name="roles" value={r} defaultChecked={roleSet(selected).includes(r)} /> {ROLE_LABELS[r] ?? r}</label>
      ))}
    </span>
  );
  const all = await prisma.approvalStage.findMany({ orderBy: { order: 'asc' } });
  const preparers = Object.fromEntries(await Promise.all(TYPES.map(async (t) => [t.kind, await getPreparerSlots(t.kind)] as const)));
  const unlockRoles = Object.fromEntries(await Promise.all(TYPES.map(async (t) => [t.kind, await getUnlockRoles(t.kind)] as const)));
  const override = await adminOverride();

  return (
    <Shell user={user} active="/admin">
      <PageTitle
        title="Approval matrix"
        subtitle="Everything about who signs, approves and unlocks each report type is set here — nothing is built into the app. 1 · sign-off slots are signed before approval, only by users with one of the slot's roles. 2 · approval steps come next, in order; the report is sealed (and emailed as approved) after the LAST step. 3 · unlock decides who may reopen an approved report."
      />
      {searchParams.msg && <div className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.msg}</div>}
      {searchParams.err && <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{searchParams.err}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm">
        <span>
          <b>Admin step-in is {override ? 'ON' : 'OFF'}.</b>{' '}
          {override
            ? 'Admins may approve or reject any step, set the intake Decision, override QC results and unlock — even without the step\'s role.'
            : 'Admins act only where their role appears in the matrix, like everyone else.'}{' '}
          <span className="text-stone-500">Sign-off slots are never covered — they are always signed by their own role.</span>
        </span>
        <form action={saveOverride}><input type="hidden" name="on" value={override ? '0' : '1'} /><button className="btn-secondary">Switch {override ? 'off' : 'on'}</button></form>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {TYPES.map((t) => {
          const stages = all.filter((s) => s.recordType === t.key);
          return (
            <Card key={t.key} title={t.label}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">1 · Sign-offs before approval</div>
              <p className="mb-2 text-xs text-stone-500">
                Each slot can only be signed by users with one of its roles. Submitting signs the submitter&apos;s own slot.
              </p>
              <ul className="mb-2 space-y-2">
                {preparers[t.kind].length === 0 && <li className="text-sm text-stone-400">No sign-off slots — reports go straight to approval.</li>}
                {preparers[t.kind].map((p, i) => (
                  <li key={p.title} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 p-2 text-sm">
                    <span className="min-w-0 flex-1"><span className="font-medium">{p.title}</span><br /><span className="text-xs text-stone-500">signed by: {labelOf(p.role)}</span></span>
                    <form action={updateSlot} className="flex w-full flex-wrap items-center gap-2">
                      <input type="hidden" name="kind" value={t.kind} /><input type="hidden" name="title" value={p.title} /><input type="hidden" name="op" value="role" />
                      <RoleChecks selected={p.role} allowAny />
                      <button className="rounded border border-stone-200 px-1.5 text-xs text-stone-600 hover:bg-stone-50">Save roles</button>
                    </form>
                    <span className="flex shrink-0 items-center gap-1">
                      {i > 0 && (
                        <form action={updateSlot}><input type="hidden" name="kind" value={t.kind} /><input type="hidden" name="title" value={p.title} /><input type="hidden" name="op" value="up" /><button className="rounded border border-stone-200 px-1.5 text-xs text-stone-500 hover:bg-stone-50" title="move up">↑</button></form>
                      )}
                      {i < preparers[t.kind].length - 1 && (
                        <form action={updateSlot}><input type="hidden" name="kind" value={t.kind} /><input type="hidden" name="title" value={p.title} /><input type="hidden" name="op" value="down" /><button className="rounded border border-stone-200 px-1.5 text-xs text-stone-500 hover:bg-stone-50" title="move down">↓</button></form>
                      )}
                      <form action={updateSlot}><input type="hidden" name="kind" value={t.kind} /><input type="hidden" name="title" value={p.title} /><input type="hidden" name="op" value="remove" /><button className="rounded border border-stone-200 px-1.5 text-xs text-red-600 hover:bg-red-50" title="remove">✕</button></form>
                    </span>
                  </li>
                ))}
              </ul>
              <form action={addSlot} className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-stone-300 p-2 text-sm">
                <input type="hidden" name="kind" value={t.kind} />
                <label className="min-w-0 flex-1">Slot title<br /><input name="title" required className="field" placeholder="e.g. Godown Keeper" /></label>
                <div className="w-full text-xs">Signed by (tick one or more)<br /><RoleChecks selected="" allowAny /></div>
                <button className="btn-secondary">Add slot</button>
              </form>

              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">2 · Approval steps</div>
              {stages.length === 0 && (
                <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  No approval steps — these reports cannot be submitted until you add at least one.
                </p>
              )}
              <ol className="space-y-2">
                {stages.map((s, i) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 p-2 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.title}</span>
                      <br /><span className="text-xs text-stone-500">approved by: {labelOf(s.role)}{override ? ' (Admin may step in)' : ''}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {i > 0 && (
                        <form action={moveStage}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value="up" /><button className="rounded border border-stone-200 px-1.5 text-xs text-stone-500 hover:bg-stone-50" title="move up">↑</button></form>
                      )}
                      {i < stages.length - 1 && (
                        <form action={moveStage}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="dir" value="down" /><button className="rounded border border-stone-200 px-1.5 text-xs text-stone-500 hover:bg-stone-50" title="move down">↓</button></form>
                      )}
                      <form action={removeStage}><input type="hidden" name="id" value={s.id} /><button className="rounded border border-stone-200 px-1.5 text-xs text-red-600 hover:bg-red-50" title="remove">✕</button></form>
                    </span>
                    <form action={updateStageRoles} className="flex w-full flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={s.id} />
                      <RoleChecks selected={s.role} allowAny={false} />
                      <button className="rounded border border-stone-200 px-1.5 text-xs text-stone-600 hover:bg-stone-50">Save roles</button>
                    </form>
                  </li>
                ))}
              </ol>
              <form action={addStage} className="mt-3 space-y-2 rounded-lg border border-dashed border-stone-300 p-3 text-sm">
                <input type="hidden" name="recordType" value={t.key} />
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Add step {stages.length + 1}</div>
                <label className="block">Step title (becomes the signature slot)<br />
                  <input name="title" required className="field" placeholder={stages.length === 0 ? 'e.g. Mill Supervisor' : 'e.g. General Manager'} />
                </label>
                <div className="text-xs">Who approves this step (tick one or more)<br /><RoleChecks selected="" allowAny={false} /></div>
                <button className="btn-secondary">Add step</button>
              </form>

              <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-stone-500">3 · Unlock approved reports</div>
              <form action={saveUnlock} className="rounded-lg border border-stone-200 p-2 text-sm">
                <input type="hidden" name="kind" value={t.kind} />
                <p className="mb-1 text-xs text-stone-500">These roles may reopen an approved report (all signatures are voided) and remove other people&apos;s sign-offs.</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-1 text-xs">
                      <input type="checkbox" name={`r_${r}`} defaultChecked={unlockRoles[t.kind].includes(r)} /> {ROLE_LABELS[r] ?? r}
                    </label>
                  ))}
                </div>
                <button className="btn-secondary mt-2">Save</button>
              </form>
            </Card>
          );
        })}
      </div>

      <p className="mt-4 max-w-3xl rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
        Changes apply to reports approved from now on. A report already mid-chain keeps its progress; if you shorten a chain
        below a report&apos;s progress, it waits on the new last step. Rejection at any step sends the report back to the editor and
        clears approval signatures. The report is final only after the last step approves.
      </p>
    </Shell>
  );
}
