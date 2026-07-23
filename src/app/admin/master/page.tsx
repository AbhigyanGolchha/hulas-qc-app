import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser, hashPassword } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { ROLES, ROLE_LABELS } from '@/lib/constants';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

async function guard() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
  return user;
}

async function addSupplier(formData: FormData) {
  'use server';
  const user = await guard();
  const name = String(formData.get('name') || '').trim();
  const sapVendorCode = String(formData.get('sap') || '').trim() || null;
  if (!name) return;
  await prisma.supplier.upsert({ where: { name }, create: { name, sapVendorCode }, update: { active: true, sapVendorCode } });
  await logAudit(user, 'MASTER', name, 'CREATE', 'supplier', null, name);
  revalidatePath('/admin/master');
}

async function toggleSupplier(formData: FormData) {
  'use server';
  const user = await guard();
  const id = String(formData.get('id'));
  const s = await prisma.supplier.findUnique({ where: { id } });
  if (!s) return;
  await prisma.supplier.update({ where: { id }, data: { active: !s.active } });
  await logAudit(user, 'MASTER', id, 'UPDATE', 'supplier.active', String(s.active), String(!s.active));
  revalidatePath('/admin/master');
}

async function updateProduct(formData: FormData) {
  'use server';
  const user = await guard();
  const id = String(formData.get('id'));
  const shelfLifeDays = formData.get('shelfLifeDays') ? Number(formData.get('shelfLifeDays')) : null;
  const sapMaterialCode = String(formData.get('sap') || '').trim() || null;
  const before = await prisma.product.findUnique({ where: { id } });
  await prisma.product.update({ where: { id }, data: { shelfLifeDays, sapMaterialCode } });
  await logAudit(user, 'MASTER', id, 'UPDATE', 'product.shelfLifeDays', String(before?.shelfLifeDays), String(shelfLifeDays));
  revalidatePath('/admin/master');
}

async function updateMill(formData: FormData) {
  'use server';
  const user = await guard();
  const id = String(formData.get('id'));
  const data = {
    totalRecoveryMin: formData.get('trmin') ? Number(formData.get('trmin')) : null,
    totalRecoveryMax: formData.get('trmax') ? Number(formData.get('trmax')) : null,
    mainYieldMin: formData.get('mymin') ? Number(formData.get('mymin')) : null,
    mainYieldMax: formData.get('mymax') ? Number(formData.get('mymax')) : null,
    sapPlantCode: String(formData.get('sap') || '').trim() || null,
  };
  await prisma.mill.update({ where: { id }, data });
  await logAudit(user, 'MASTER', id, 'UPDATE', 'mill.thresholds', null, JSON.stringify(data));
  revalidatePath('/admin/master');
}

async function addUser(formData: FormData) {
  'use server';
  const user = await guard();
  if (user.role !== 'ADMIN') return;
  const username = String(formData.get('username') || '').trim().toLowerCase();
  const name = String(formData.get('name') || '').trim();
  const role = String(formData.get('role') || 'QC');
  const millId = String(formData.get('millId') || '') || null;
  const password = String(formData.get('password') || '');
  if (!username || !name || password.length < 6) return;
  await prisma.user.create({ data: { username, name, role, millId, passwordHash: hashPassword(password) } });
  await logAudit(user, 'MASTER', username, 'CREATE', 'user', null, `${name} (${role})`);
  revalidatePath('/admin/master');
}

async function addPackSize(formData: FormData) {
  'use server';
  const user = await guard();
  const label = String(formData.get('label') || '').trim();
  const grams = Number(formData.get('grams'));
  if (!label || !grams) return;
  const count = await prisma.packSize.count();
  await prisma.packSize.upsert({ where: { label }, create: { label, grams, sortOrder: count + 1 }, update: { active: true, grams } });
  await logAudit(user, 'MASTER', label, 'CREATE', 'packSize', null, label);
  revalidatePath('/admin/master');
}

export default async function MasterAdmin() {
  const user = await guard();
  const [mills, products, suppliers, packSizes, users] = await Promise.all([
    prisma.mill.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, orderBy: [{ mill: { sortOrder: 'asc' } }, { sortOrder: 'asc' }], include: { mill: true } }),
    prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.packSize.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.user.findMany({ orderBy: { name: 'asc' }, include: { mill: true } }),
  ]);

  return (
    <Shell user={user} active="/admin">
      <PageTitle title="Master data" subtitle="SAP codes are optional and stay blank until integration day — the schema is ready." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Mills — yield sanity thresholds (%)">
          <div className="space-y-3">
            {mills.map((m) => (
              <form key={m.id} action={updateMill} className="flex flex-wrap items-end gap-2 text-sm">
                <input type="hidden" name="id" value={m.id} />
                <span className="w-36 font-medium">{m.name}</span>
                <label className="text-xs">Total rec. min<br /><input name="trmin" type="number" step="any" defaultValue={m.totalRecoveryMin ?? ''} className="field w-20" /></label>
                <label className="text-xs">max<br /><input name="trmax" type="number" step="any" defaultValue={m.totalRecoveryMax ?? ''} className="field w-20" /></label>
                <label className="text-xs">Main yield min<br /><input name="mymin" type="number" step="any" defaultValue={m.mainYieldMin ?? ''} className="field w-20" /></label>
                <label className="text-xs">max<br /><input name="mymax" type="number" step="any" defaultValue={m.mainYieldMax ?? ''} className="field w-20" /></label>
                <label className="text-xs">SAP plant<br /><input name="sap" defaultValue={m.sapPlantCode ?? ''} className="field w-24" /></label>
                <button className="btn-secondary">Save</button>
              </form>
            ))}
          </div>
        </Card>

        <Card title="Products — shelf life (drives best-before)">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {products.map((p) => (
              <form key={p.id} action={updateProduct} className="flex flex-wrap items-end gap-2 text-sm">
                <input type="hidden" name="id" value={p.id} />
                <span className="w-56 truncate">{p.mill.name} — <b>{p.name}</b>{p.kind === 'BYPRODUCT' && <span className="text-xs text-stone-400"> (by-product)</span>}</span>
                <label className="text-xs">Shelf life (days)<br /><input name="shelfLifeDays" type="number" defaultValue={p.shelfLifeDays ?? ''} className="field w-24" /></label>
                <label className="text-xs">SAP material<br /><input name="sap" defaultValue={p.sapMaterialCode ?? ''} className="field w-28" /></label>
                <button className="btn-secondary">Save</button>
              </form>
            ))}
          </div>
        </Card>

        <Card title="Suppliers">
          <ul className="mb-3 space-y-1 text-sm">
            {suppliers.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className={s.active ? '' : 'text-stone-400 line-through'}>{s.name}</span>
                {s.sapVendorCode && <span className="text-xs text-stone-400">SAP {s.sapVendorCode}</span>}
                <form action={toggleSupplier}><input type="hidden" name="id" value={s.id} /><button className="text-xs text-brand-700 hover:underline">{s.active ? 'deactivate' : 'reactivate'}</button></form>
              </li>
            ))}
          </ul>
          <form action={addSupplier} className="flex flex-wrap items-end gap-2 text-sm">
            <label>Name<br /><input name="name" className="field w-56" placeholder="New supplier / party" /></label>
            <label>SAP vendor code<br /><input name="sap" className="field w-32" /></label>
            <button className="btn-secondary">Add</button>
          </form>
        </Card>

        <Card title="Pack sizes">
          <ul className="mb-3 flex flex-wrap gap-2 text-sm">
            {packSizes.map((p) => (
              <li key={p.id} className={`rounded-full border px-3 py-1 ${p.active ? 'border-stone-200' : 'border-stone-100 text-stone-400 line-through'}`}>{p.label}</li>
            ))}
          </ul>
          <form action={addPackSize} className="flex flex-wrap items-end gap-2 text-sm">
            <label>Label<br /><input name="label" className="field w-36" placeholder="25 kg bora" /></label>
            <label>Grams<br /><input name="grams" type="number" className="field w-28" placeholder="25000" /></label>
            <button className="btn-secondary">Add</button>
          </form>
        </Card>

        <Card title="Users" className="xl:col-span-2">
          <table className="mb-4 w-full text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr><th className="py-1">Name</th><th className="py-1">Username</th><th className="py-1">Role</th><th className="py-1">Mill</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-stone-100">
                  <td className="py-1.5">{u.name}</td>
                  <td className="py-1.5"><code>{u.username}</code></td>
                  <td className="py-1.5">{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}</td>
                  <td className="py-1.5">{u.mill?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {user.role === 'ADMIN' ? (
            <form action={addUser} className="flex flex-wrap items-end gap-2 text-sm">
              <label>Full name<br /><input name="name" className="field w-44" /></label>
              <label>Username<br /><input name="username" className="field w-32" /></label>
              <label>Role<br /><select name="role" className="field w-40">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
              <label>Mill (supervisors)<br /><select name="millId" className="field w-40"><option value="">—</option>{mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
              <label>Password (min 6)<br /><input name="password" type="password" className="field w-36" /></label>
              <button className="btn-secondary">Add user</button>
            </form>
          ) : (
            <p className="text-xs text-stone-400">Only Admin can add users.</p>
          )}
        </Card>
      </div>
    </Shell>
  );
}
