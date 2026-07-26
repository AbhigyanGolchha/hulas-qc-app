import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { logAudit } from '@/lib/audit';
import { OPERATORS, OPERATOR_LABELS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

async function saveSpec(formData: FormData) {
  'use server';
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') return;
  const parameterId = String(formData.get('parameterId'));
  const operator = String(formData.get('operator'));
  const min = formData.get('min') ? Number(formData.get('min')) : null;
  const max = formData.get('max') ? Number(formData.get('max')) : null;
  const textExpected = String(formData.get('textExpected') || '').trim() || null;
  const displayText = String(formData.get('displayText') || '').trim();
  const sourceTag = String(formData.get('sourceTag') || 'INTERNAL');
  const regulatoryRef = String(formData.get('regulatoryRef') || '').trim() || null;
  const note = String(formData.get('note') || '').trim() || null;
  if (!displayText) return;

  const last = await prisma.specVersion.findFirst({ where: { parameterId }, orderBy: { version: 'desc' } });
  const created = await prisma.specVersion.create({
    data: {
      parameterId,
      version: (last?.version ?? 0) + 1,
      operator, min, max, textExpected, displayText, sourceTag, regulatoryRef, note,
      createdBy: user.name,
    },
  });
  await logAudit(user, 'SPEC', parameterId, 'UPDATE', 'spec', last?.displayText, `${displayText} (v${created.version})`);
  revalidatePath('/admin/specs');
}

async function guardAdmin() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
  return user;
}

// what prints in the Standard Specification column when the admin leaves it blank
function autoDisplayText(operator: string, min: number | null, max: number | null, textExpected: string | null, unit: string | null): string {
  const u = unit ? ` ${unit}` : '';
  switch (operator) {
    case 'LTE': return `≤ ${max ?? '?'}${u}`;
    case 'LT': return `< ${max ?? '?'}${u}`;
    case 'GTE': return `≥ ${min ?? '?'}${u}`;
    case 'GT': return `> ${min ?? '?'}${u}`;
    case 'RANGE': return `${min ?? '?'} – ${max ?? '?'}${u}`;
    case 'NIL': return 'Nil';
    case 'RECORD': return 'To record';
    case 'TEXT_MATCH': return textExpected ?? 'as specified';
    default: return '—';
  }
}

async function addMaterial(formData: FormData) {
  'use server';
  const user = await guardAdmin();
  const name = String(formData.get('name') || '').trim();
  if (!name) redirect('/admin/specs?err=' + encodeURIComponent('The material needs a name.'));
  const exists = await prisma.material.findUnique({ where: { name } });
  if (exists) redirect('/admin/specs?err=' + encodeURIComponent(`"${name}" already exists${exists.active ? '' : ' (it is retired — reactivate it instead)'}.`));
  const last = await prisma.material.findFirst({ orderBy: { sortOrder: 'desc' } });
  const m = await prisma.material.create({ data: { name, sortOrder: (last?.sortOrder ?? 0) + 1 } });
  await logAudit(user, 'MASTER', m.id, 'CREATE', 'material', null, name);
  redirect(`/admin/specs?t=m:${m.id}&msg=` + encodeURIComponent(`"${name}" created — now add its parameters below.`));
}

async function addProduct(formData: FormData) {
  'use server';
  const user = await guardAdmin();
  const name = String(formData.get('name') || '').trim();
  const millId = String(formData.get('millId') || '');
  if (!name || !millId) redirect('/admin/specs?err=' + encodeURIComponent('The product needs a name and a mill.'));
  const last = await prisma.product.findFirst({ where: { millId }, orderBy: { sortOrder: 'desc' } });
  const p = await prisma.product.create({
    data: { name, millId, kind: 'PRODUCT', hasQcSheet: true, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });
  await logAudit(user, 'MASTER', p.id, 'CREATE', 'product', null, name);
  redirect(`/admin/specs?t=p:${p.id}&msg=` + encodeURIComponent(`"${name}" created — now add its parameters below.`));
}

async function addParameter(formData: FormData) {
  'use server';
  const user = await guardAdmin();
  const sel = String(formData.get('template') || '');
  const [kind, id] = sel.split(':');
  const name = String(formData.get('name') || '').trim();
  const operator = String(formData.get('operator'));
  if (!name) redirect(`/admin/specs?t=${sel}&err=` + encodeURIComponent('The parameter needs a name.'));
  const unit = String(formData.get('unit') || '').trim() || null;
  const valueType = String(formData.get('valueType') || 'NUMBER');
  const optionsRaw = String(formData.get('options') || '').trim();
  const min = formData.get('min') ? Number(formData.get('min')) : null;
  const max = formData.get('max') ? Number(formData.get('max')) : null;
  const textExpected = String(formData.get('textExpected') || '').trim() || null;
  const displayText = String(formData.get('displayText') || '').trim() || autoDisplayText(operator, min, max, textExpected, unit);
  const where = kind === 'm' ? { materialId: id } : { productId: id };
  const last = await prisma.parameter.findFirst({ where, orderBy: { sortOrder: 'desc' } });
  const p = await prisma.parameter.create({
    data: {
      ...where,
      name,
      unit,
      valueType,
      options: valueType === 'SELECT' && optionsRaw ? JSON.stringify(optionsRaw.split(',').map((s) => s.trim()).filter(Boolean)) : null,
      sampleCount: formData.get('threeSamples') === 'on' ? 3 : 1,
      hasIr: formData.get('hasIr') === 'on',
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  // a parameter without a spec version never appears on report sheets — create v1 with it
  await prisma.specVersion.create({
    data: {
      parameterId: p.id,
      version: 1,
      operator, min, max, textExpected, displayText,
      sourceTag: String(formData.get('sourceTag') || 'INTERNAL'),
      regulatoryRef: String(formData.get('regulatoryRef') || '').trim() || null,
      note: String(formData.get('note') || '').trim() || null,
      createdBy: user.name,
    },
  });
  await logAudit(user, 'MASTER', p.id, 'CREATE', 'parameter', null, `${name} (${displayText})`);
  redirect(`/admin/specs?t=${sel}&msg=` + encodeURIComponent(`"${name}" added — it appears on every NEW sheet from now on.`));
}

async function toggleTemplate(formData: FormData) {
  'use server';
  const user = await guardAdmin();
  const kind = String(formData.get('kind'));
  const id = String(formData.get('id'));
  if (kind === 'm') {
    const m = await prisma.material.findUniqueOrThrow({ where: { id } });
    await prisma.material.update({ where: { id }, data: { active: !m.active } });
    await logAudit(user, 'MASTER', id, 'UPDATE', 'material.active', String(m.active), String(!m.active));
    redirect(m.active ? '/admin/specs' : `/admin/specs?t=m:${id}`);
  }
  const p = await prisma.product.findUniqueOrThrow({ where: { id } });
  await prisma.product.update({ where: { id }, data: { active: !p.active } });
  await logAudit(user, 'MASTER', id, 'UPDATE', 'product.active', String(p.active), String(!p.active));
  redirect(p.active ? '/admin/specs' : `/admin/specs?t=p:${id}`);
}

async function toggleParameter(formData: FormData) {
  'use server';
  const user = await guardAdmin();
  const id = String(formData.get('id'));
  const sel = String(formData.get('template') || '');
  const p = await prisma.parameter.findUniqueOrThrow({ where: { id } });
  await prisma.parameter.update({ where: { id }, data: { active: !p.active } });
  await logAudit(user, 'MASTER', id, 'UPDATE', 'parameter.active', String(p.active), String(!p.active));
  redirect(`/admin/specs?t=${sel}`);
}

export default async function SpecsAdmin({ searchParams }: { searchParams: { t?: string; p?: string; msg?: string; err?: string } }) {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');

  const [materials, products, mills, retiredMaterials, retiredProducts] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.product.findMany({ where: { active: true, hasQcSheet: true }, orderBy: [{ mill: { sortOrder: 'asc' } }, { sortOrder: 'asc' }], include: { mill: true } }),
    prisma.mill.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.material.findMany({ where: { active: false }, orderBy: { sortOrder: 'asc' } }),
    prisma.product.findMany({ where: { active: false, hasQcSheet: true }, orderBy: { sortOrder: 'asc' }, include: { mill: true } }),
  ]);

  const sel = searchParams.t ?? `m:${materials[0]?.id}`;
  const [kind, id] = sel.split(':');
  const where = kind === 'm' ? { materialId: id } : { productId: id };
  const params = await prisma.parameter.findMany({
    where,
    orderBy: { sortOrder: 'asc' },
    include: { specVersions: { orderBy: { version: 'desc' } } },
  });
  const editing = searchParams.p ? params.find((p) => p.id === searchParams.p) : null;
  const selName = kind === 'm' ? materials.find((m) => m.id === id)?.name : products.find((p) => p.id === id)?.name;

  return (
    <Shell user={user} active="/admin">
      <PageTitle
        title="Parameters & spec limits"
        subtitle="Changing a spec creates a new version. Reports always show the version in force when they were tested. New materials and products added here appear on the New-sheet screens immediately."
      />
      {searchParams.msg && <div className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.msg}</div>}
      {searchParams.err && <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{searchParams.err}</div>}
      <div className="mb-4 flex flex-wrap gap-1.5 text-sm">
        {materials.map((m) => (
          <Link key={m.id} href={`/admin/specs?t=m:${m.id}`} className={`rounded-full border px-3 py-1 ${sel === `m:${m.id}` ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
            Spot: {m.name}
          </Link>
        ))}
        {products.map((p) => (
          <Link key={p.id} href={`/admin/specs?t=p:${p.id}`} className={`rounded-full border px-3 py-1 ${sel === `p:${p.id}` ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
            {p.name}
          </Link>
        ))}
      </div>

      <details className="mb-4 rounded-xl border border-stone-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-medium text-brand-700">+ New material or product template</summary>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <form action={addMaterial} className="space-y-2 rounded-lg border border-stone-200 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">New intake material (spot analysis at the gate)</div>
            <label className="block">Name<br /><input name="name" className="field" placeholder="e.g. Corn" required /></label>
            <button className="btn-primary">Create material</button>
            <p className="text-xs text-stone-500">Creates an empty template — add its test parameters below, then it shows up on the New Spot Analysis screen.</p>
          </form>
          <form action={addProduct} className="space-y-2 rounded-lg border border-stone-200 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">New finished product (gets its own QC sheet)</div>
            <label className="block">Name<br /><input name="name" className="field" placeholder="e.g. Corn Grits" required /></label>
            <label className="block">Mill<br />
              <select name="millId" className="field" required>
                {mills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <button className="btn-primary">Create product</button>
          </form>
        </div>
        {(retiredMaterials.length > 0 || retiredProducts.length > 0) && (
          <div className="mt-3 rounded-lg border border-stone-200 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Retired templates (hidden from the New-sheet screens — old reports keep working)</div>
            <div className="flex flex-wrap gap-2">
              {retiredMaterials.map((m) => (
                <form key={m.id} action={toggleTemplate} className="flex items-center gap-1 rounded-full border border-stone-200 px-3 py-1 text-stone-500">
                  <input type="hidden" name="kind" value="m" /><input type="hidden" name="id" value={m.id} />
                  Spot: {m.name} <button className="text-brand-700 hover:underline">restore</button>
                </form>
              ))}
              {retiredProducts.map((p) => (
                <form key={p.id} action={toggleTemplate} className="flex items-center gap-1 rounded-full border border-stone-200 px-3 py-1 text-stone-500">
                  <input type="hidden" name="kind" value="p" /><input type="hidden" name="id" value={p.id} />
                  {p.name} ({p.mill.name}) <button className="text-brand-700 hover:underline">restore</button>
                </form>
              ))}
            </div>
          </div>
        )}
      </details>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">Parameter</th>
              <th className="px-3 py-2">Current spec</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Regulatory reference</th>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => {
              const cur = p.specVersions[0];
              return (
                <tr key={p.id} className={`border-t border-stone-100 align-top ${p.active ? '' : 'opacity-40'}`}>
                  <td className="px-3 py-2 font-medium">{p.name}{p.unit && <span className="ml-1 text-xs text-stone-400">({p.unit})</span>}{!p.active && <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">retired</span>}<br />
                    <span className="text-xs text-stone-400">{p.sampleCount === 3 ? '3 samples' : '1 sample'}{p.hasIr ? ' + IR' : ''}</span>
                  </td>
                  <td className="px-3 py-2">{cur?.displayText}</td>
                  <td className="px-3 py-2">{cur?.sourceTag === 'INTERNAL' ? '⚙ internal' : '📖 reference'}</td>
                  <td className="px-3 py-2 text-xs text-stone-500">{cur?.regulatoryRef ?? '—'}{cur?.note ? <><br />{cur.note}</> : null}</td>
                  <td className="px-3 py-2">v{cur?.version}
                    {p.specVersions.length > 1 && (
                      <details className="text-xs text-stone-500">
                        <summary className="cursor-pointer">history</summary>
                        <ul className="mt-1 space-y-0.5">
                          {p.specVersions.slice(1).map((v) => (
                            <li key={v.id}>v{v.version}: {v.displayText} <span className="text-stone-400">({v.createdBy})</span></li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/admin/specs?t=${sel}&p=${p.id}`} className="text-brand-700 hover:underline">edit</Link>
                    <form action={toggleParameter} className="mt-1 inline-block">
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="template" value={sel} />
                      <button className="text-xs text-stone-500 hover:underline">{p.active ? 'retire' : 'restore'}</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selName && (
        <form action={toggleTemplate} className="mb-4 text-xs">
          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
          <button className="text-stone-400 hover:text-red-600 hover:underline">Retire &quot;{selName}&quot; (hides it from New-sheet screens; old reports keep working)</button>
        </form>
      )}

      <Card title={`Add a parameter to ${selName ?? 'this template'}`} className="mt-4 max-w-3xl">
        <form action={addParameter} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="template" value={sel} />
          <label className="text-sm">Parameter name<br /><input name="name" required className="field" placeholder="e.g. Moisture" /></label>
          <label className="text-sm">Unit (optional)<br /><input name="unit" className="field" placeholder="e.g. %" /></label>
          <label className="text-sm">Value type<br />
            <select name="valueType" className="field">
              <option value="NUMBER">Number</option>
              <option value="TEXT">Text</option>
              <option value="SELECT">Choice list</option>
            </select>
          </label>
          <label className="text-sm">Choices (only for choice list, comma-separated)<br /><input name="options" className="field" placeholder="e.g. OK, Not OK" /></label>
          <label className="text-sm">Rule<br />
            <select name="operator" className="field">
              {OPERATORS.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
            </select>
          </label>
          <label className="text-sm">Display text (leave blank to auto-write from the rule)<br /><input name="displayText" className="field" placeholder="e.g. ≤ 14.0 %" /></label>
          <label className="text-sm">Min<br /><input name="min" type="number" step="any" className="field" /></label>
          <label className="text-sm">Max<br /><input name="max" type="number" step="any" className="field" /></label>
          <label className="text-sm">Expected text (for text-match rules)<br /><input name="textExpected" className="field" /></label>
          <label className="text-sm">Source<br />
            <select name="sourceTag" className="field">
              <option value="INTERNAL">⚙ internal (Hulas spec)</option>
              <option value="REFERENCE">📖 reference (published standard)</option>
            </select>
          </label>
          <div className="flex items-center gap-4 text-sm sm:col-span-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="threeSamples" /> 3 samples, auto-averaged (moisture-style)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="hasIr" /> extra IR instrument reading</label>
          </div>
          <label className="text-sm sm:col-span-2">Regulatory reference (context only)<br /><input name="regulatoryRef" className="field" placeholder="e.g. DFTQC: moisture ≤ 14%" /></label>
          <label className="text-sm sm:col-span-2">Note<br /><input name="note" className="field" /></label>
          <div className="sm:col-span-2">
            <button className="btn-primary">Add parameter</button>
            <p className="mt-1 text-xs text-stone-500">The parameter (with spec v1) appears on every sheet created after this. Existing sheets keep the columns they were made with.</p>
          </div>
        </form>
      </Card>

      {editing && (
        <Card title={`New spec version — ${editing.name}`} className="mt-4 max-w-2xl">
          {editing.specVersions[0]?.sourceTag === 'REFERENCE' && (
            <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              📖 This limit was seeded from published standards (FSSAI/FCI/NIFTEM). Verify against Nepal NS/DFTQC requirements and your own lab practice before relying on it.
            </p>
          )}
          <form action={saveSpec} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input type="hidden" name="parameterId" value={editing.id} />
            <label className="text-sm">Rule<br />
              <select name="operator" defaultValue={editing.specVersions[0]?.operator} className="field">
                {OPERATORS.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
              </select>
            </label>
            <label className="text-sm">Display text (prints on the report)<br />
              <input name="displayText" defaultValue={editing.specVersions[0]?.displayText} required className="field" />
            </label>
            <label className="text-sm">Min<br /><input name="min" type="number" step="any" defaultValue={editing.specVersions[0]?.min ?? ''} className="field" /></label>
            <label className="text-sm">Max<br /><input name="max" type="number" step="any" defaultValue={editing.specVersions[0]?.max ?? ''} className="field" /></label>
            <label className="text-sm">Expected text (for text-match rules)<br /><input name="textExpected" defaultValue={editing.specVersions[0]?.textExpected ?? ''} className="field" /></label>
            <label className="text-sm">Source<br />
              <select name="sourceTag" defaultValue={editing.specVersions[0]?.sourceTag} className="field">
                <option value="INTERNAL">⚙ internal (Hulas spec)</option>
                <option value="REFERENCE">📖 reference (published standard)</option>
              </select>
            </label>
            <label className="text-sm sm:col-span-2">Regulatory reference value (shown for context, not enforced)<br />
              <input name="regulatoryRef" defaultValue={editing.specVersions[0]?.regulatoryRef ?? ''} className="field" placeholder="e.g. FSSAI: ash ≤ 1.0%" />
            </label>
            <label className="text-sm sm:col-span-2">Note<br /><input name="note" defaultValue={editing.specVersions[0]?.note ?? ''} className="field" /></label>
            <div className="sm:col-span-2">
              <button className="btn-primary">Save as new version (v{(editing.specVersions[0]?.version ?? 0) + 1})</button>
            </div>
          </form>
        </Card>
      )}
    </Shell>
  );
}
