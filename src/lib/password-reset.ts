// Self-service "Forgot password?". Two ways back in, picked automatically:
//
// 1. The account has an email address and email is switched on → a reset link
//    valid for RESET_MINUTES is emailed. The link is an HMAC over the user's
//    CURRENT password hash, so it stops working the moment the password
//    changes — it can be used once, and an admin reset kills it too.
// 2. Otherwise (no email, or SMTP not set up yet) → the request is recorded
//    and the Admins are told; they see it on Admin → Users next to the
//    existing "Reset password…" button and hand over a temporary password.
//
// The page never says whether a username exists, and requests are rate
// limited per account so nobody can flood a mailbox.
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from './db';
import { enqueueMail, getMailConfig, isMailConfigured } from './mail';
import { hashPassword, passwordProblem, ipField } from './auth';

const SECRET = process.env.SESSION_SECRET || 'hulas-dev-secret';
export const RESET_MINUTES = 30;
const COOLDOWN_MINUTES = 5;

export const RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED';
// actions after which an open request counts as dealt with
const RESOLVED = ['PASSWORD_RESET', 'PASSWORD_RESET_SELF', 'PASSWORD_CHANGED'];

function sign(userId: string, exp: number, passwordHash: string) {
  return createHmac('sha256', SECRET).update(`pwreset:${userId}.${exp}.${passwordHash}`).digest('base64url');
}

export function createResetToken(user: { id: string; passwordHash: string }): string {
  const exp = Math.floor(Date.now() / 1000) + RESET_MINUTES * 60;
  return `${user.id}.${exp}.${sign(user.id, exp, user.passwordHash)}`;
}

// → the user the token belongs to, or null (bad, expired, already used, inactive)
export async function checkResetToken(token: string | undefined) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  const want = Buffer.from(sign(user.id, exp, user.passwordHash));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return user;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// Handle a "Forgot password?" form. baseUrl = the address the person is using
// right now (so the link works on the plant LAN as well as anywhere else).
export async function requestPasswordReset(identifier: string, baseUrl: string): Promise<void> {
  const id = identifier.trim().toLowerCase();
  if (!id) return;
  const user = await prisma.user.findFirst({ where: { active: true, OR: [{ username: id }, { email: id }] } });
  if (!user) {
    await prisma.auditLog.create({ data: { userName: id, recordType: 'AUTH', field: ipField(), recordId: id, action: RESET_REQUESTED, newValue: 'no active account with that username/email — nothing sent' } });
    return;
  }

  // one request per account per few minutes — later ones are ignored quietly
  const recent = await prisma.auditLog.findFirst({
    where: { recordType: 'AUTH', field: ipField(), recordId: user.id, action: RESET_REQUESTED, at: { gt: new Date(Date.now() - COOLDOWN_MINUTES * 60000) } },
  });
  if (recent) return;

  const cfg = await getMailConfig();
  if (user.email && isMailConfigured(cfg)) {
    const link = `${baseUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(createResetToken(user))}`;
    const text = [
      'Reset your Hulas QC password',
      '',
      `Someone (hopefully you) asked to reset the password for username "${user.username}".`,
      `Open this link within ${RESET_MINUTES} minutes to choose a new password:`,
      link,
      '',
      'If you did not ask for this, ignore this email — your password stays as it is.',
    ].join('\n');
    const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1c1917;line-height:1.5;max-width:560px">
  <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#78716c;margin-bottom:6px">Hulas Khadya QC</div>
  <h2 style="margin:0 0 12px;font-size:18px">Reset your password</h2>
  <p>Someone (hopefully you) asked to reset the password for username <b>${esc(user.username)}</b>.</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#2e7d32;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:600">Choose a new password</a></p>
  <p style="color:#57534e">The link works once and expires in ${RESET_MINUTES} minutes. If you did not ask for this, ignore this email — your password stays as it is.</p>
</div>`;
    await enqueueMail({ event: 'PASSWORD_RESET_LINK', userId: user.id, toEmail: user.email, toName: user.name, subject: '[Hulas QC] Reset your password', bodyText: text, bodyHtml: html });
    await prisma.auditLog.create({ data: { userId: user.id, userName: user.name, recordType: 'AUTH', field: ipField(), recordId: user.id, action: RESET_REQUESTED, newValue: `reset link emailed to ${user.email}` } });
    return;
  }

  // no way to reach them directly — hand it to the Admins
  await prisma.auditLog.create({
    data: { userId: user.id, userName: user.name, recordType: 'AUTH', field: ipField(), recordId: user.id, action: RESET_REQUESTED, newValue: user.email ? 'email is switched off — Admin asked to reset' : 'no email on the account — Admin asked to reset' },
  });
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', active: true, email: { not: null }, id: { not: user.id } } });
  for (const a of admins) {
    await enqueueMail({
      event: 'PASSWORD_RESET_REQUEST',
      userId: a.id,
      toEmail: a.email!,
      toName: a.name,
      subject: `[Hulas QC] ${user.name} asked for a password reset`,
      bodyText: `${user.name} (${user.username}) forgot their password and asked for a reset.\n\nOpen Admin → Users → ${user.name} → "Reset password…" and pass the temporary password on to them.\n${cfg.appUrl}/admin/users`,
    });
  }
}

// Open "forgot password" requests the Admin still has to act on, by user id.
export async function openResetRequests(): Promise<Map<string, Date>> {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const rows = await prisma.auditLog.findMany({
    where: { recordType: 'AUTH', field: ipField(), at: { gt: since }, action: { in: [RESET_REQUESTED, ...RESOLVED] }, userId: { not: null } },
    orderBy: { at: 'asc' },
  });
  const open = new Map<string, Date>();
  for (const r of rows) {
    if (r.action === RESET_REQUESTED) {
      if (r.newValue?.includes('Admin asked')) open.set(r.recordId, r.at);
    } else open.delete(r.recordId);
  }
  return open;
}

// Set the new password from a valid link. Returns an error message or null.
export async function completePasswordReset(token: string, pw: string, pw2: string): Promise<string | null> {
  const user = await checkResetToken(token);
  if (!user) return 'This reset link is no longer valid — it expired or was already used. Ask for a new one.';
  if (pw !== pw2) return 'The two passwords do not match.';
  const problem = passwordProblem(pw);
  if (problem) return problem;
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(pw), mustChangePassword: false, failedLogins: 0, lockedUntil: null },
  });
  await prisma.auditLog.create({ data: { userId: user.id, userName: user.name, recordType: 'AUTH', field: ipField(), recordId: user.id, action: 'PASSWORD_RESET_SELF', newValue: 'new password set via emailed reset link' } });
  return null;
}
