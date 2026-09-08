// Admin → Notifications: SMTP settings, who gets which event, a test button,
// and the outgoing mail log with retry. Everything the app emails goes through
// the queue shown here, so this page is also the place to see what was sent.
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { ROLES, ROLE_LABELS } from '@/lib/constants';
import { logAudit } from '@/lib/audit';
import { getMailConfig, isMailConfigured, sendRaw, verifySmtp, sendPendingMail, deliverNotification } from '@/lib/mail';
import { EVENTS, getRules, saveRules, type EventKey, type Rules } from '@/lib/notify';
import { fmtNpt } from '@/lib/dates';

export const dynamic = 'force-dynamic';

function isRedirect(e: unknown) {
  return Boolean((e as any)?.digest?.startsWith?.('NEXT_REDIRECT'));
}
const go = (q: Record<string, string>) => redirect('/admin/notifications?' + new URLSearchParams(q).toString());

async function guard() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
  return user;
}

async function saveSmtp(formData: FormData) {
  'use server';
  const user = await guard();
  const set = async (k: string, v: string) => prisma.setting.upsert({ where: { key: `mail.${k}` }, create: { key: `mail.${k}`, value: v }, update: { value: v } });
  for (const k of ['host', 'port', 'user', 'from', 'appUrl']) await set(k, String(formData.get(k) ?? '').trim());
  await set('secure', formData.get('secure') === 'on' ? 'true' : 'false');
  await set('enabled', formData.get('enabled') === 'on' ? 'true' : 'false');
  const pw = String(formData.get('password') ?? '');
  if (pw) await set('password', pw);
  await logAudit(user, 'MASTER', 'mail-config', 'UPDATE', 'mail.settings', null, `host=${formData.get('host')}, enabled=${formData.get('enabled') === 'on'}`);
  go({ msg: 'Email settings saved.' });
}

async function saveRoutes(formData: FormData) {
  'use server';
  const user = await guard();
  const rules: Rules = {};
  for (const k of Object.keys(EVENTS) as EventKey[]) {
    rules[k] = {
      roles: ROLES.filter((r) => formData.get(`${k}__${r}`) === 'on'),
      extraEmails: String(formData.get(`${k}__extra`) ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
    };
  }
  await saveRules(rules);
  await logAudit(user, 'MASTER', 'notify-rules', 'UPDATE', 'notify.rules', null, JSON.stringify(rules));
  go({ msg: 'Routing saved.' });
}

async function testConnection() {
  'use server';
  await guard();
  const r = await verifySmtp(await getMailConfig());
  go(r.ok ? { msg: `SMTP test: ${r.message}` } : { err: `SMTP test failed: ${r.message}` });
}

async function sendTest(formData: FormData) {
  'use server';
  const user = await guard();
  const to = String(formData.get('to') || user.email || '').trim();
  if (!to) go({ err: 'Enter an address to send the test to (or set your own email on your profile).' });
  try {
    const cfg = await getMailConfig();
    await sendRaw(cfg, { to, subject: '[Hulas QC] Test email', text: `This is a test from Hulas Khadya QC, sent by ${user.name} at ${fmtNpt(new Date())}. If you can read this, email notifications work.` });
    await prisma.notification.create({ data: { event: 'TEST', toEmail: to, subject: '[Hulas QC] Test email', bodyText: 'test', status: 'SENT', attempts: 1, sentAt: new Date(), userId: user.id } });
    go({ msg: `Test email sent to ${to}.` });
  } catch (e) {
    if (isRedirect(e)) throw e;
    go({ err: `Test email failed: ${(e as Error).message}` });
  }
}

async function flushQueue() {
  'use server';
  await guard();
  const r = await sendPendingMail();
  go({ msg: `Queue: ${r.sent} sent, ${r.failed} failed.` });
}

async function retryOne(formData: FormData) {
  'use server';
  await guard();
  const id = String(formData.get('id'));
  await prisma.notification.update({ where: { id }, data: { status: 'PENDING', attempts: 0, lastError: null } });
  const r = await deliverNotification(id);
  go(r.ok ? { msg: 'Sent.' } : { err: `Still failing: ${r.error}` });
}

export default async function NotificationsAdmin({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await guard();
  const cfg = await getMailConfig();
  const configured = isMailConfigured(cfg);
  const hasPw = Boolean(cfg.password);
  const rules = await getRules();
  const log = await prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 150 });
  const counts = {
    pending: await prisma.notification.count({ where: { status: 'PENDING' } }),
    skipped: await prisma.notification.count({ where: { status: 'SKIPPED' } }),
    failed: await prisma.notification.count({ where: { status: 'FAILED' } }),
  };
  const usersNoEmail = await prisma.user.count({ where: { active: true, email: null } });

  return (
    <Shell user={user} active="/admin">
      <PageTitle title="Notifications (email)" subtitle="Every module raises events — submit, approve, reject, unlock, QC fail, gate rejection, yield warning, SAP failure. Decide here who is told, and how the emails go out." />
      {searchParams.msg && <div className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{searchParams.msg}</div>}
      {searchParams.err && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.err}</div>}
      {!configured && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Email is <b>off</b>. Events are still recorded below (as SKIPPED) so you can see what would have gone out; nothing is sent until SMTP is filled in and switched on.
        </div>
      )}
      {usersNoEmail > 0 && (
        <div className="mb-3 rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          {usersNoEmail} active user{usersNoEmail > 1 ? 's have' : ' has'} no email address yet — add them in Admin → Users (or each user on their profile).
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="SMTP server (outgoing mail)">
          <form action={saveSmtp} className="space-y-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={cfg.enabled} /> <b>Send emails</b> (master switch)</label>
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block">SMTP host<br /><input name="host" defaultValue={cfg.host} className="field" placeholder="smtp.office365.com / smtp.gmail.com" /></label>
              <label className="block">Port<br /><input name="port" type="number" defaultValue={cfg.port} className="field" /></label>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" name="secure" defaultChecked={cfg.secure} /> Use SMTPS (implicit TLS, port 465). Leave off for port 587 / STARTTLS.</label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">Login user<br /><input name="user" defaultValue={cfg.user} className="field" autoComplete="off" placeholder="qc@hulas.com" /></label>
              <label className="block">Password {hasPw && <span className="text-xs text-stone-400">(set — blank keeps it)</span>}<br /><input name="password" type="password" className="field" autoComplete="new-password" placeholder={hasPw ? '••••••••' : 'app password'} /></label>
            </div>
            <label className="block">From address<br /><input name="from" defaultValue={cfg.from} className="field" placeholder="Hulas QC <qc@hulas.com>" /></label>
            <label className="block">App URL (used in email links)<br /><input name="appUrl" defaultValue={cfg.appUrl} className="field" placeholder="http://192.168.1.20:3000" /></label>
            <p className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
              Microsoft 365: host <code>smtp.office365.com</code>, port 587, STARTTLS, the mailbox login. Gmail / Google Workspace: <code>smtp.gmail.com</code>, port 587, an <b>App password</b> (not the normal one).
              In production prefer the <code>SMTP_PASSWORD</code> environment variable — it always wins over the stored one.
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton className="btn-primary" busyLabel="Saving…">Save settings</ActionButton>
            </div>
          </form>
          <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <form action={testConnection}><ActionButton busyLabel="Testing…">Test SMTP login</ActionButton></form>
            <form action={sendTest} className="flex items-end gap-2">
              <label className="text-xs">Send a test email to<br /><input name="to" type="email" defaultValue={user.email ?? ''} className="field w-56" placeholder="you@hulas.com" /></label>
              <ActionButton busyLabel="Sending…">Send test</ActionButton>
            </form>
          </div>
        </Card>

        <Card title="Who is told about what">
          <form action={saveRoutes} className="space-y-3 text-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left uppercase text-stone-500">
                  <tr><th className="py-1 pr-2">Event</th>{ROLES.map((r) => <th key={r} className="px-1 py-1 text-center">{ROLE_LABELS[r].split(' ')[0]}</th>)}<th className="py-1 pl-2">Extra addresses</th></tr>
                </thead>
                <tbody>
                  {(Object.keys(EVENTS) as EventKey[]).map((k) => (
                    <tr key={k} className="border-t border-stone-100 align-top">
                      <td className="py-2 pr-2">
                        <div className="font-medium text-sm">{EVENTS[k].label}</div>
                        <div className="text-stone-400">{EVENTS[k].hint}{EVENTS[k].involved ? ' The preparer / signers always get it.' : ''}</div>
                      </td>
                      {ROLES.map((r) => (
                        <td key={r} className="px-1 py-2 text-center"><input type="checkbox" name={`${k}__${r}`} defaultChecked={rules[k].roles.includes(r)} /></td>
                      ))}
                      <td className="py-2 pl-2"><input name={`${k}__extra`} defaultValue={rules[k].extraEmails.join(', ')} className="field w-44" placeholder="owner@hulas.com" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-stone-400">Supervisors only receive events for their own mill. Nobody is emailed about their own action. Each user can mute events on their profile.</p>
            <ActionButton className="btn-primary" busyLabel="Saving…">Save routing</ActionButton>
          </form>
        </Card>
      </div>

      <Card title={`Outgoing mail log — ${counts.pending} pending · ${counts.skipped} skipped · ${counts.failed} failed`} className="mt-4">
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          <form action={flushQueue}><ActionButton busyLabel="Sending…">Send pending now ({counts.pending + counts.skipped})</ActionButton></form>
          <span className="self-center text-xs text-stone-400">Or keep <code>npm run mail:worker</code> running on the server to retry automatically.</span>
        </div>
        <div className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
          {log.map((n) => (
            <details key={n.id} className="rounded border border-stone-200 p-2 text-sm">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="text-xs text-stone-500">{fmtNpt(n.createdAt)}</span>
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{n.event}</span>
                <span className="truncate">{n.subject}</span>
                <span className="text-xs text-stone-500">→ {n.toName ? `${n.toName} <${n.toEmail}>` : n.toEmail}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${n.status === 'SENT' ? 'bg-green-50 text-green-700' : n.status === 'FAILED' ? 'bg-red-50 text-red-700' : n.status === 'SKIPPED' ? 'bg-stone-100 text-stone-600' : 'bg-amber-50 text-amber-700'}`}>{n.status}</span>
              </summary>
              {n.lastError && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{n.lastError}</p>}
              {(n.status === 'FAILED' || n.status === 'SKIPPED') && configured && (
                <form action={retryOne} className="mt-2"><input type="hidden" name="id" value={n.id} /><ActionButton busyLabel="Sending…">Send now</ActionButton></form>
              )}
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs">{n.bodyText}</pre>
            </details>
          ))}
          {!log.length && <p className="text-sm text-stone-400">Nothing yet — submit or approve a report and it appears here.</p>}
        </div>
      </Card>
    </Shell>
  );
}
