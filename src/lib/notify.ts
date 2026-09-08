// Notification events → who hears about them. Every module raises events
// through notifyEvent(); this file decides the recipients (role routing from
// Admin → Notifications, plus the people already involved in the record),
// writes the email, and hands it to the mail queue. Users can mute events on
// /profile; users without an email address are silently skipped.
import { prisma } from './db';
import { enqueueMail, getMailConfig } from './mail';
import { fmtNpt } from './dates';
import type { RecordKind } from './sign';

export type EventKey =
  | 'SUBMITTED'
  | 'STAGE_APPROVED'
  | 'APPROVED'
  | 'REJECTED'
  | 'UNLOCKED'
  | 'QC_FAILED'
  | 'INTAKE_REJECTED'
  | 'YIELD_WARNING'
  | 'SAP_FAILED';

export const EVENTS: Record<EventKey, { label: string; hint: string; defaultRoles: string[]; involved: boolean }> = {
  SUBMITTED: {
    label: 'Report submitted for approval',
    hint: 'Sent to the role that must approve the current step (from Admin → Approval flow). Supervisors only get their own mill.',
    defaultRoles: ['MANAGER'],
    involved: false,
  },
  STAGE_APPROVED: {
    label: 'Approval step completed (multi-step chains)',
    hint: 'One step of a chain approved — the next approver is told it is their turn; the preparer sees progress.',
    defaultRoles: [],
    involved: true,
  },
  APPROVED: {
    label: 'Report fully approved',
    hint: 'Goes to the person who prepared / submitted it, plus these roles.',
    defaultRoles: [],
    involved: true,
  },
  REJECTED: {
    label: 'Report rejected',
    hint: 'Goes to the preparer with the reason, plus these roles.',
    defaultRoles: [],
    involved: true,
  },
  UNLOCKED: {
    label: 'Approved report unlocked for editing',
    hint: 'All signatures were voided — everyone who had signed is told, plus these roles.',
    defaultRoles: ['MANAGER'],
    involved: true,
  },
  QC_FAILED: {
    label: 'QC sheet submitted with overall FAIL',
    hint: 'A finished-product sheet was submitted failing spec.',
    defaultRoles: ['MANAGER', 'QC'],
    involved: false,
  },
  INTAKE_REJECTED: {
    label: 'Raw material lot rejected or accepted with deduction',
    hint: 'Gate decision on an intake report (at submit).',
    defaultRoles: ['MANAGER'],
    involved: false,
  },
  YIELD_WARNING: {
    label: 'Production yield outside the expected band',
    hint: 'Daily production submitted with recovery or main-product yield outside the mill limits.',
    defaultRoles: ['MANAGER'],
    involved: false,
  },
  SAP_FAILED: {
    label: 'SAP delivery failed after all retries',
    hint: 'Only if SAP posting is switched on (it is off by default). An approved record could not be posted to SAP B1.',
    defaultRoles: ['ADMIN'],
    involved: false,
  },
};

export type Rules = Record<string, { roles: string[]; extraEmails: string[] }>;

export async function getRules(): Promise<Rules> {
  const s = await prisma.setting.findUnique({ where: { key: 'notify.rules' } });
  let saved: Rules = {};
  try { saved = s ? JSON.parse(s.value) : {}; } catch { saved = {}; }
  const out: Rules = {};
  for (const k of Object.keys(EVENTS) as EventKey[]) {
    out[k] = saved[k] ?? { roles: EVENTS[k].defaultRoles, extraEmails: [] };
  }
  return out;
}

export async function saveRules(rules: Rules) {
  await prisma.setting.upsert({ where: { key: 'notify.rules' }, create: { key: 'notify.rules', value: JSON.stringify(rules) }, update: { value: JSON.stringify(rules) } });
}

export function parsePrefs(json: string | null | undefined): Record<string, boolean> {
  try { return json ? JSON.parse(json) : {}; } catch { return {}; }
}

// ---------- record description (what the email talks about) ----------

export type RecordInfo = {
  kind: RecordKind;
  id: string;
  reportNo: string;
  title: string; // "Daily Production DP-2083-0002 — Roller Flour Mill"
  millId: string | null;
  createdById: string | null;
  status: string;
  approvalStage: number;
  url: string;
  lines: string[]; // key facts for the email body
};

export async function describeRecord(kind: RecordKind, id: string): Promise<RecordInfo> {
  const { appUrl } = await getMailConfig();
  if (kind === 'intake') {
    const r = await prisma.intakeReport.findUniqueOrThrow({ where: { id }, include: { material: true, supplier: true, mill: true } });
    return {
      kind, id, reportNo: r.reportNo, millId: r.millId, createdById: r.createdById, status: r.status, approvalStage: r.approvalStage,
      title: `Spot Analysis ${r.reportNo} — ${r.material.name}${r.supplier ? ' from ' + r.supplier.name : ''}`,
      url: `${appUrl}/intake/${r.id}`,
      lines: [
        `Material: ${r.material.name}${r.variety ? ' (' + r.variety + ')' : ''}`,
        `Supplier: ${r.supplier?.name ?? '—'}`,
        `Weight: ${r.weightKg?.toLocaleString('en-IN') ?? '—'} kg · Vehicle ${r.vehicleNo ?? '—'} · Challan ${r.challanNo ?? '—'}`,
        `Decision: ${r.decision ?? 'pending'}${r.decisionReason ? ' — ' + r.decisionReason : ''}`,
        `Date: ${r.dateAd.toISOString().slice(0, 10)} (Miti ${r.dateBs})`,
      ],
    };
  }
  if (kind === 'qc') {
    const r = await prisma.qcReport.findUniqueOrThrow({ where: { id }, include: { product: true, batch: { include: { mill: true } } } });
    return {
      kind, id, reportNo: r.reportNo, millId: r.batch.millId, createdById: r.createdById, status: r.status, approvalStage: r.approvalStage,
      title: `QC ${r.reportNo} — ${r.product.name} (${r.batch.mill.name}, batch ${r.batch.batchNo})`,
      url: `${appUrl}/qc/${r.id}`,
      lines: [
        `Product: ${r.product.name} · Batch ${r.batch.batchNo} · ${r.batch.mill.name}`,
        `Overall result: ${r.overallResult ?? 'pending'}${r.overallOverridden ? ' (manager override: ' + (r.overrideReason ?? '') + ')' : ''}`,
        r.remarks ? `Remarks: ${r.remarks}` : '',
        `Date: ${r.dateAd.toISOString().slice(0, 10)} (Miti ${r.dateBs})`,
      ].filter(Boolean),
    };
  }
  const r = await prisma.productionReport.findUniqueOrThrow({ where: { id }, include: { mill: true, batch: true, inputs: true } });
  const net = r.inputs.reduce((a, i) => a + (i.netKg ?? 0), 0);
  return {
    kind, id, reportNo: r.reportNo, millId: r.millId, createdById: r.createdById, status: r.status, approvalStage: r.approvalStage,
    title: `Daily Production ${r.reportNo} — ${r.mill.name} (batch ${r.batch.batchNo})`,
    url: `${appUrl}/production/${r.id}`,
    lines: [
      `Mill: ${r.mill.name} · Batch ${r.batch.batchNo}`,
      `Net raw material input: ${net.toLocaleString('en-IN')} kg`,
      `Shift: ${r.startTime ?? '—'} – ${r.closeTime ?? '—'} · Manpower ${r.manpower ?? '—'}`,
      `Date: ${r.dateAd.toISOString().slice(0, 10)} (Miti ${r.dateBs})`,
    ],
  };
}

// ---------- recipients ----------

type Recipient = { email: string; name: string; userId: string | null };

async function usersForRoles(roles: string[], millId: string | null): Promise<Recipient[]> {
  if (!roles.length) return [];
  const users = await prisma.user.findMany({ where: { active: true, role: { in: roles }, email: { not: null } } });
  return users
    // supervisors only hear about their own mill; everyone else hears about all mills
    .filter((u) => u.role !== 'SUPERVISOR' || !millId || !u.millId || u.millId === millId)
    .map((u) => ({ email: u.email!, name: u.name, userId: u.id }));
}

// people already on the record: creator + everyone who signed a slot
async function involvedUsers(rec: RecordInfo): Promise<Recipient[]> {
  const ids = new Set<string>();
  if (rec.createdById) ids.add(rec.createdById);
  const sigs = await prisma.signature.findMany({ where: { recordType: rec.kind.toUpperCase(), recordId: rec.id } });
  for (const s of sigs) if (s.userId) ids.add(s.userId);
  if (!ids.size) return [];
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] }, active: true, email: { not: null } } });
  return users.map((u) => ({ email: u.email!, name: u.name, userId: u.id }));
}

async function resolveRecipients(event: EventKey, rec: RecordInfo | null, opts: { roles?: string[]; exclude?: string | null; include?: Recipient[] } = {}) {
  const rules = await getRules();
  const rule = rules[event];
  const list: Recipient[] = [];
  list.push(...(await usersForRoles(opts.roles ?? rule.roles, rec?.millId ?? null)));
  if (rec && EVENTS[event].involved) list.push(...(await involvedUsers(rec)));
  if (opts.include) list.push(...opts.include);
  for (const e of rule.extraEmails) if (e) list.push({ email: e, name: e, userId: null });

  // muted events + dedupe by email; the actor never gets told about their own action
  const userIds = list.map((r) => r.userId).filter(Boolean) as string[];
  const prefs = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, notifyPrefs: true } }) : [];
  const muted = new Set(prefs.filter((p) => parsePrefs(p.notifyPrefs)[event] === false).map((p) => p.id));
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = r.email.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    if (r.userId && (muted.has(r.userId) || r.userId === opts.exclude)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- templates ----------

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function render(headline: string, rec: RecordInfo | null, extra: string[], footer: string) {
  const lines = [...(rec?.lines ?? []), ...extra];
  const when = fmtNpt(new Date());
  const text = [
    headline,
    '',
    ...(rec ? [rec.title, ''] : []),
    ...lines,
    '',
    ...(rec ? [`Open it: ${rec.url}`, ''] : []),
    footer,
    '',
    `— Hulas Khadya QC · ${when}`,
  ].join('\n');
  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1c1917;line-height:1.5;max-width:640px">
  <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#78716c;margin-bottom:6px">Hulas Khadya QC</div>
  <h2 style="margin:0 0 12px;font-size:18px">${esc(headline)}</h2>
  ${rec ? `<div style="font-weight:600;margin-bottom:8px">${esc(rec.title)}</div>` : ''}
  <table style="border-collapse:collapse;margin-bottom:12px">${lines.map((l) => `<tr><td style="padding:2px 0;color:#44403c">${esc(l)}</td></tr>`).join('')}</table>
  ${rec ? `<p><a href="${rec.url}" style="display:inline-block;background:#2e7d32;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:600">Open the report</a></p>` : ''}
  <p style="color:#57534e">${esc(footer)}</p>
  <p style="font-size:11px;color:#a8a29e">${esc(when)} · You receive this because of your role or because you are on this report. Mute events on your profile page.</p>
</div>`;
  return { text, html };
}

// ---------- the one entry point every module calls ----------

export type NotifyArgs = {
  event: EventKey;
  kind?: RecordKind;
  recordId?: string;
  actor?: { id: string; name: string } | null; // whoever did the thing — never emailed about their own action
  reason?: string;
  extraLines?: string[];
  roles?: string[]; // override role routing (e.g. the next approval stage's role)
};

export async function notifyEvent(args: NotifyArgs): Promise<number> {
  try {
    const rec = args.kind && args.recordId ? await describeRecord(args.kind, args.recordId) : null;
    const actorName = args.actor?.name ?? 'Someone';
    const kindLabel = rec ? { intake: 'intake report', qc: 'QC sheet', production: 'daily production report' }[rec.kind] : 'record';
    let headline = '';
    let subject = '';
    let footer = '';
    const extra = [...(args.extraLines ?? [])];

    switch (args.event) {
      case 'SUBMITTED':
        headline = `${actorName} submitted a ${kindLabel} for approval`;
        subject = `[Hulas QC] ${rec?.reportNo} submitted — waiting for your approval`;
        footer = 'Please review and approve or reject it in the app.';
        break;
      case 'STAGE_APPROVED':
        headline = `${actorName} approved a step — next approver, it is your turn`;
        subject = `[Hulas QC] ${rec?.reportNo} — approval step done, next step waiting`;
        footer = 'The report is not final until the last step approves.';
        break;
      case 'APPROVED':
        headline = `${actorName} approved the ${kindLabel}`;
        subject = `[Hulas QC] ${rec?.reportNo} approved`;
        footer = 'The record is now sealed (read-only until a Manager unlocks it).';
        break;
      case 'REJECTED':
        headline = `${actorName} rejected the ${kindLabel}`;
        subject = `[Hulas QC] ${rec?.reportNo} rejected — needs correction`;
        if (args.reason) extra.push(`Reason: ${args.reason}`);
        footer = 'Fix the issues and submit it again.';
        break;
      case 'UNLOCKED':
        headline = `${actorName} unlocked an approved ${kindLabel} for editing`;
        subject = `[Hulas QC] ${rec?.reportNo} unlocked — all signatures voided`;
        if (args.reason) extra.push(`Reason: ${args.reason}`);
        footer = 'Everyone signs again after the edits.';
        break;
      case 'QC_FAILED':
        headline = `QC sheet submitted with overall result FAIL`;
        subject = `[Hulas QC] ⚠ ${rec?.reportNo} FAILED spec`;
        footer = 'Decide on the batch (hold / rework / release with override) in the app.';
        break;
      case 'INTAKE_REJECTED':
        headline = `Gate decision on an incoming lot: ${extra.shift() ?? 'rejected / deduction'}`;
        subject = `[Hulas QC] ⚠ ${rec?.reportNo} — lot ${rec?.lines[3]?.includes('REJECTED') ? 'rejected' : 'accepted with deduction'}`;
        footer = 'The supplier settlement follows this report.';
        break;
      case 'YIELD_WARNING':
        headline = `Production yield outside the expected band`;
        subject = `[Hulas QC] ⚠ ${rec?.reportNo} — yield outside limits`;
        footer = 'Check the input weight and output rows before approving.';
        break;
      case 'SAP_FAILED':
        headline = `SAP delivery failed after all retries`;
        subject = `[Hulas QC] ⚠ SAP delivery FAILED — ${rec?.reportNo ?? args.recordId ?? ''}`;
        footer = 'Open Admin → SAP connection, read the error, fix it and press Retry.';
        break;
    }

    const recipients = await resolveRecipients(args.event, rec, { roles: args.roles, exclude: args.actor?.id ?? null });
    if (!recipients.length) return 0;
    const { text, html } = render(headline, rec, extra, footer);
    for (const r of recipients) {
      await enqueueMail({
        event: args.event,
        recordType: rec ? rec.kind.toUpperCase() : null,
        recordId: rec?.id ?? args.recordId ?? null,
        userId: r.userId,
        toEmail: r.email,
        toName: r.name,
        subject,
        bodyText: text,
        bodyHtml: html,
      });
    }
    return recipients.length;
  } catch (e) {
    // notifications must never break the workflow that raised them
    console.error('notifyEvent failed:', e);
    return 0;
  }
}

// Account emails go straight to one person regardless of routing rules.
export async function sendAccountMail(user: { id: string; name: string; email: string | null; username: string }, kind: 'INVITE' | 'RESET', tempPassword: string, byName: string) {
  if (!user.email) return;
  const { appUrl } = await getMailConfig();
  const headline = kind === 'INVITE' ? 'Your Hulas QC account is ready' : 'Your Hulas QC password was reset';
  const lines = [
    `Username: ${user.username}`,
    `Temporary password: ${tempPassword}`,
    `Sign in: ${appUrl}/login`,
  ];
  const footer = `You will be asked to choose your own password on first sign-in. ${kind === 'INVITE' ? 'Account created' : 'Reset done'} by ${byName}.`;
  const { text, html } = render(headline, null, lines, footer);
  await enqueueMail({ event: kind === 'INVITE' ? 'USER_INVITE' : 'PASSWORD_RESET', userId: user.id, toEmail: user.email, toName: user.name, subject: `[Hulas QC] ${headline}`, bodyText: text, bodyHtml: html });
}
