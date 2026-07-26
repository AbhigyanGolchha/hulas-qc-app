import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { logAudit } from '@/lib/audit';
import { getSapConfig, testConnection, syncPending, deliverRow } from '@/lib/connector';
import { pullSuppliersFromB1 } from '@/lib/sap-pull';
import { ActionButton } from '@/components/action-button';

// Next's redirect() works by throwing — anything else is a real error to show the user
function isRedirect(e: unknown) {
  return Boolean((e as any)?.digest?.startsWith?.('NEXT_REDIRECT'));
}

export const dynamic = 'force-dynamic';

async function guard() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
  return user;
}

async function saveConfig(formData: FormData) {
  'use server';
  const user = await guard();
  const keys = ['profile', 'baseUrl', 'username', 'client', 'pathInspectionLot', 'pathConfirmation', 'b1ProductionMode'];
  for (const k of keys) {
    const v = String(formData.get(k) ?? '').trim();
    await prisma.setting.upsert({ where: { key: `sap.${k}` }, create: { key: `sap.${k}`, value: v }, update: { value: v } });
  }
  const pw = String(formData.get('password') ?? '');
  if (pw) {
    await prisma.setting.upsert({ where: { key: 'sap.password' }, create: { key: 'sap.password', value: pw }, update: { value: pw } });
  }
  const autoSend = formData.get('autoSend') === 'on' ? 'true' : 'false';
  await prisma.setting.upsert({ where: { key: 'sap.autoSend' }, create: { key: 'sap.autoSend', value: autoSend }, update: { value: autoSend } });
  const b1Batches = formData.get('b1SendBatches') === 'on' ? 'true' : 'false';
  await prisma.setting.upsert({ where: { key: 'sap.b1SendBatches' }, create: { key: 'sap.b1SendBatches', value: b1Batches }, update: { value: b1Batches } });
  await logAudit(user, 'MASTER', 'sap-config', 'UPDATE', 'sap.settings', null, `profile=${formData.get('profile')}, autoSend=${autoSend}`);
  redirect('/admin/sap?saved=1');
}

async function runTest() {
  'use server';
  await guard();
  const r = await testConnection();
  redirect(`/admin/sap?test=${encodeURIComponent(r.message)}&testok=${r.ok ? 1 : 0}`);
}

async function runSync() {
  'use server';
  const user = await guard();
  try {
    const r = await syncPending();
    await logAudit(user, 'MASTER', 'sap-sync', 'UPDATE', 'outbox', null, `sent=${r.sent}, failed=${r.failed}`);
    redirect(`/admin/sap?sync=${encodeURIComponent(`sent ${r.sent}, failed ${r.failed}`)}&syncok=${r.failed === 0 ? 1 : 0}`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`/admin/sap?sync=${encodeURIComponent(String((e as Error).message ?? e))}&syncok=0`);
  }
}

async function runPullSuppliers() {
  'use server';
  const user = await guard();
  try {
    const r = await pullSuppliersFromB1();
    await logAudit(user, 'MASTER', 'sap-pull', 'UPDATE', 'suppliers', null, `fetched=${r.fetched}, created=${r.created}, updated=${r.updated}, linked=${r.linked}`);
    redirect(`/admin/sap?pull=${encodeURIComponent(`${r.fetched} suppliers in SAP — ${r.created} added, ${r.linked} linked to existing, ${r.updated} refreshed`)}&pullok=1`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`/admin/sap?pull=${encodeURIComponent(String((e as Error).message ?? e))}&pullok=0`);
  }
}

async function retryRow(formData: FormData) {
  'use server';
  await guard();
  const id = String(formData.get('id'));
  await prisma.integrationOutbox.update({ where: { id }, data: { status: 'PENDING', attempts: 0, lastError: null } });
  try {
    const r = await deliverRow(id);
    revalidatePath('/admin/sap');
    if (r.ok) redirect(`/admin/sap?retry=${encodeURIComponent(`delivered → ${r.docNo ?? 'ok'}`)}&retryok=1`);
    redirect(`/admin/sap?retry=${encodeURIComponent(r.error ?? 'delivery failed — see the row below')}&retryok=0`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    redirect(`/admin/sap?retry=${encodeURIComponent(String((e as Error).message ?? e))}&retryok=0`);
  }
}

export default async function SapAdmin({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await guard();
  const cfg = await getSapConfig();
  const hasStoredPw = Boolean((await prisma.setting.findUnique({ where: { key: 'sap.password' } }))?.value) || Boolean(process.env.SAP_PASSWORD);
  const queue = await prisma.integrationOutbox.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const counts = {
    pending: queue.filter((q) => q.status === 'PENDING').length,
    sent: queue.filter((q) => q.status === 'SENT').length,
    failed: queue.filter((q) => q.status === 'FAILED').length,
  };

  return (
    <Shell user={user} active="/admin">
      <PageTitle
        title="SAP connection"
        subtitle="Every approval queues a document here and the connector delivers it to SAP Business One. Waiting on IT for the Service Layer URL, CompanyDB and technical user — until then the mock profile can simulate deliveries for demos."
      />

      {searchParams.saved && <Banner tone="ok">Settings saved.</Banner>}
      {searchParams.test && <Banner tone={searchParams.testok === '1' ? 'ok' : 'warn'}>Connection test: {searchParams.test}</Banner>}
      {searchParams.sync && <Banner tone={searchParams.syncok === '1' ? 'ok' : 'warn'}>Sync finished — {searchParams.sync}.</Banner>}
      {searchParams.pull && <Banner tone={searchParams.pullok === '1' ? 'ok' : 'warn'}>Supplier pull: {searchParams.pull}</Banner>}
      {searchParams.retry && <Banner tone={searchParams.retryok === '1' ? 'ok' : 'warn'}>Retry: {searchParams.retry}</Banner>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Connection settings">
          <form action={saveConfig} className="space-y-3 text-sm">
            <label className="block">System profile<br />
              <select name="profile" defaultValue={cfg.profile} className="field">
                <option value="mock">Mock — no SAP yet (validate + simulate delivery)</option>
                <option value="s4hana">S/4HANA / ECC with Gateway (OData APIs)</option>
                <option value="b1">SAP Business One (Service Layer)</option>
              </select>
            </label>
            <label className="block">Base URL<br />
              <input name="baseUrl" defaultValue={cfg.baseUrl} className="field" placeholder="https://b1-server.hulasgroup.local:50000" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">Technical user<br /><input name="username" defaultValue={cfg.username} className="field" autoComplete="off" /></label>
              <label className="block">Password {hasStoredPw && <span className="text-xs text-stone-400">(set — leave blank to keep)</span>}<br />
                <input name="password" type="password" className="field" autoComplete="new-password" placeholder={hasStoredPw ? '••••••••' : ''} />
              </label>
            </div>
            <label className="block">Client / CompanyDB<br /><input name="client" defaultValue={cfg.client} className="field w-40" placeholder="e.g. HULAS_LIVE" /></label>
            <div className="rounded border border-stone-200 bg-stone-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Business One options</div>
              <label className="block">Production reports post as<br />
                <select name="b1ProductionMode" defaultValue={cfg.b1ProductionMode} className="field">
                  <option value="udo">HULAS_QC UDO rows — safe start, no item mapping needed</option>
                  <option value="documents">Issue/Receipt for Production documents — needs item codes + SAP order no. on each batch</option>
                </select>
              </label>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" name="b1SendBatches" defaultChecked={cfg.b1SendBatches} />
                Send batch numbers on receipt lines (items are batch-managed in B1)
              </label>
              <p className="mt-2 text-xs text-stone-500">
                First time: run <code>npm run b1:provision</code> once to create the HULAS_QC table/UDO in B1
                (intake &amp; QC reports always land there).
              </p>
            </div>
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer">Advanced: endpoint paths</summary>
              <label className="mt-2 block">Inspection lot / QC endpoint<br /><input name="pathInspectionLot" defaultValue={cfg.pathInspectionLot} className="field" /></label>
              <label className="mt-2 block">Production confirmation endpoint<br /><input name="pathConfirmation" defaultValue={cfg.pathConfirmation} className="field" /></label>
            </details>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="autoSend" defaultChecked={cfg.autoSend} />
              Deliver to SAP immediately on approval (otherwise the worker/manual sync sends)
            </label>
            <p className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
              Tip: in production set <code>SAP_PASSWORD</code> as an environment variable instead of storing it here — the env var always wins.
              Field mappings live in <code>src/lib/connector.ts</code> and must be finalized with your SAP consultant before go-live.
            </p>
            <div className="flex gap-2">
              <ActionButton className="btn-primary" busyLabel="Saving…">Save settings</ActionButton>
            </div>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={runTest}><ActionButton busyLabel="Testing…">Test connection</ActionButton></form>
            <form action={runSync}><ActionButton busyLabel="Syncing…">Sync now ({counts.pending} pending)</ActionButton></form>
            <form action={runPullSuppliers}><ActionButton busyLabel="Pulling from SAP…">Pull suppliers from SAP</ActionButton></form>
          </div>
        </Card>

        <Card title={`Delivery queue — ${counts.sent} sent · ${counts.pending} pending · ${counts.failed} failed`}>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {queue.map((q) => (
              <details key={q.id} className="rounded border border-stone-200 p-2 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{q.recordType === 'SAP_QM_INSPECTION_LOT' ? 'QM lot' : 'Prod conf'}</span>
                  <span className="text-xs text-stone-500">{q.createdAt.toISOString().replace('T', ' ').slice(0, 16)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${q.status === 'SENT' ? 'bg-green-50 text-green-700' : q.status === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{q.status}</span>
                  {q.sapDocNo && <span className="text-xs font-medium">→ {q.sapDocNo}</span>}
                  {q.attempts > 0 && q.status !== 'SENT' && <span className="text-xs text-stone-400">{q.attempts} attempt{q.attempts > 1 ? 's' : ''}</span>}
                </summary>
                {q.lastError && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{q.lastError}</p>}
                {(q.status === 'FAILED' || (q.status === 'PENDING' && q.attempts > 0)) && (
                  <form action={retryRow} className="mt-2"><input type="hidden" name="id" value={q.id} /><ActionButton busyLabel="Retrying…">Retry now</ActionButton></form>
                )}
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-stone-50 p-2 text-xs">{JSON.stringify(JSON.parse(q.payload), null, 2)}</pre>
              </details>
            ))}
            {!queue.length && <p className="text-sm text-stone-400">Empty — approve a record and it appears here.</p>}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

function Banner({ tone, children }: { tone: 'ok' | 'warn'; children: React.ReactNode }) {
  return (
    <div className={`mb-4 rounded border px-3 py-2 text-sm ${tone === 'ok' ? 'border-green-300 bg-green-50 text-green-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
      {children}
    </div>
  );
}
