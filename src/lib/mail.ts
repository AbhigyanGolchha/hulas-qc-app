// Email delivery. SMTP settings live in the Setting table (Admin →
// Notifications); the password may instead come from the SMTP_PASSWORD env
// var, which always wins. Every message is queued in the Notification table
// first and delivered from there, so an SMTP outage never loses a message —
// rows retry (worker / "Send pending") and park as FAILED after MAX_ATTEMPTS.
import nodemailer from 'nodemailer';
import { prisma } from './db';

export type MailConfig = {
  enabled: boolean; // master switch — off = messages are queued as SKIPPED (visible, never sent)
  host: string;
  port: number;
  secure: boolean; // true = SMTPS (465); false = STARTTLS/plain (587/25)
  user: string;
  password: string;
  from: string; // "Hulas QC <qc@hulas.com>"
  appUrl: string; // used to build links in emails
};

const MAX_ATTEMPTS = 5;

export async function getMailConfig(): Promise<MailConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'mail.' } } });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: s['mail.enabled'] === 'true',
    host: s['mail.host'] ?? '',
    port: Number(s['mail.port'] || 587),
    secure: s['mail.secure'] === 'true',
    user: s['mail.user'] ?? '',
    password: process.env.SMTP_PASSWORD || s['mail.password'] || '',
    from: s['mail.from'] || 'Hulas QC <no-reply@hulas.local>',
    appUrl: (s['mail.appUrl'] || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  };
}

export function isMailConfigured(cfg: MailConfig): boolean {
  return Boolean(cfg.enabled && cfg.host && cfg.from);
}

function transport(cfg: MailConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

// One raw send, no queue — used by the admin "Send test email" button and by deliverNotification().
export async function sendRaw(cfg: MailConfig, msg: { to: string; subject: string; text: string; html?: string }) {
  if (!isMailConfigured(cfg)) throw new Error('Email is not configured — fill in the SMTP settings and switch it on.');
  const info = await transport(cfg).sendMail({ from: cfg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
  return info.messageId as string;
}

export async function verifySmtp(cfg: MailConfig): Promise<{ ok: boolean; message: string }> {
  if (!cfg.host) return { ok: false, message: 'No SMTP host set.' };
  try {
    await transport(cfg).verify();
    return { ok: true, message: `Connected to ${cfg.host}:${cfg.port} — login accepted.` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message ?? e) };
  }
}

export type QueuedMail = {
  event: string;
  recordType?: string | null;
  recordId?: string | null;
  userId?: string | null;
  toEmail: string;
  toName?: string | null;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
};

// Queue a message and try to deliver it right away (fire-and-forget). With
// email switched off the row is stored as SKIPPED so the admin can still see
// what *would* have gone out.
export async function enqueueMail(m: QueuedMail): Promise<string> {
  const cfg = await getMailConfig();
  const row = await prisma.notification.create({
    data: {
      event: m.event,
      recordType: m.recordType ?? null,
      recordId: m.recordId ?? null,
      userId: m.userId ?? null,
      toEmail: m.toEmail,
      toName: m.toName ?? null,
      subject: m.subject,
      bodyText: m.bodyText,
      bodyHtml: m.bodyHtml ?? null,
      status: isMailConfigured(cfg) ? 'PENDING' : 'SKIPPED',
      lastError: isMailConfigured(cfg) ? null : 'email not configured / switched off — not sent',
    },
  });
  if (isMailConfigured(cfg)) void deliverNotification(row.id);
  return row.id;
}

export async function deliverNotification(id: string): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.notification.findUnique({ where: { id } });
  if (!row || row.status === 'SENT') return { ok: true };
  const cfg = await getMailConfig();
  if (!isMailConfigured(cfg)) return { ok: false, error: 'email not configured' };
  try {
    await sendRaw(cfg, { to: row.toEmail, subject: row.subject, text: row.bodyText, html: row.bodyHtml ?? undefined });
    await prisma.notification.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    return { ok: true };
  } catch (e) {
    const attempts = row.attempts + 1;
    await prisma.notification.update({
      where: { id },
      data: { status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', attempts, lastError: String((e as Error).message ?? e).slice(0, 1000) },
    });
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

// Deliver everything still waiting (PENDING, and SKIPPED rows if email has
// since been switched on). Used by the admin button and the mail worker.
export async function sendPendingMail(limit = 100): Promise<{ sent: number; failed: number }> {
  const cfg = await getMailConfig();
  if (!isMailConfigured(cfg)) return { sent: 0, failed: 0 };
  const rows = await prisma.notification.findMany({
    where: { status: { in: ['PENDING', 'SKIPPED'] } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let sent = 0, failed = 0;
  for (const r of rows) {
    if (r.status === 'SKIPPED') await prisma.notification.update({ where: { id: r.id }, data: { status: 'PENDING', lastError: null } });
    const res = await deliverNotification(r.id);
    if (res.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
