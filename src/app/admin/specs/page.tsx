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

export default async function SpecsAdmin({ searchParams }: { searchParams: { t?: string; p?: string } }) {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');

  const [materials, products] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.product.findMany({ where: { active: true, hasQcSheet: true }, orderBy: [{ mill: { sortOrder: 'asc' } }, { sortOrder: 'asc' }], include: { mill: true } }),
  ]);

  const sel = searchParams.t ?? `m:${materials[0]?.id}`;
  const [kind, id] = sel.split(':');
  const where = kind === 'm' ? { materialId: id } : { productId: id };
  const params = await prisma.parameter.findMany({
    where: { ...where, active: true },
    orderBy: { sortOrder: 'asc' },
    include: { specVersions: { orderBy: { version: 'desc' } } },
  });
  const editing = searchParams.p ? params.find((p) => p.id === searchParams.p) : null;

  return (
    <Shell user={user} active="/admin">
      <PageTitle
        title="Parameters & spec limits"
        subtitle="Changing a spec creates a new version. Reports always show the version in force when they were tested."
      />
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
                <tr key={p.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-2 font-medium">{p.name}{p.unit && <span className="ml-1 text-xs text-stone-400">({p.unit})</span>}<br />
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
                  <td className="px-3 py-2"><Link href={`/admin/specs?t=${sel}&p=${p.id}`} className="text-brand-700 hover:underline">edit</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
