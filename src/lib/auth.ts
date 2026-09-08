// Session auth: scrypt password hashes + HMAC-signed cookie. No external deps.
// Login hardening: failed attempts are counted per user and the account locks
// for LOCK_MINUTES after MAX_FAILED tries; every login / failure / logout is
// audited; new accounts and admin resets force a password change on first use.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from './db';

const COOKIE = 'hulas_session';
const SECRET = process.env.SESSION_SECRET || 'hulas-dev-secret';
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
export const MIN_PASSWORD = 8;

if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16)) {
  console.warn('⚠ SESSION_SECRET is missing or short — set a long random value in .env before real use.');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, 32);
  return timingSafeEqual(check, Buffer.from(hash, 'hex'));
}

// readable one-time password for invites/resets: e.g. "mango-7412-river"
export function generateTempPassword(): string {
  const words = ['mango', 'river', 'wheat', 'atta', 'chiura', 'nepal', 'maida', 'suji', 'bhuja', 'kosi', 'terai', 'himal', 'bagmati', 'gandak', 'rice', 'paddy'];
  const pick = () => words[randomBytes(1)[0] % words.length];
  const n = 1000 + (randomBytes(2).readUInt16BE(0) % 9000);
  return `${pick()}-${n}-${pick()}`;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and at least one number.';
  return null;
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function createSessionToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const payload = `${userId}.${exp}`;
  if (sign(payload) !== sig) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return userId;
}

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  millId: string | null;
  mustChangePassword: boolean;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  const userId = parseSessionToken(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  return { id: user.id, username: user.username, name: user.name, email: user.email, role: user.role, millId: user.millId, mustChangePassword: user.mustChangePassword };
}

// Every page calls this. A user flagged mustChangePassword can't go anywhere
// but the password page until they've chosen their own password.
export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    // no session (expired, signed out elsewhere, cookies cleared): remember where
    // they were so the login page can bring them straight back
    let here: string | null = null;
    try { here = headers().get('x-pathname'); } catch { here = null; }
    redirect(here && here.startsWith('/') && here !== '/' && !here.startsWith('/login') ? `/login?next=${encodeURIComponent(here)}` : '/login');
  }
  if (user.mustChangePassword && !opts.allowPasswordChange) redirect('/profile/password?first=1');
  return user;
}

export function setSessionCookie(userId: string) {
  cookies().set(COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== '1',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE);
}

export type LoginResult =
  | { ok: true; userId: string; mustChangePassword: boolean }
  | { ok: false; reason: 'bad' | 'locked' | 'inactive'; minutesLeft?: number };

// Username/password check with lockout + audit trail. Never says whether the
// username exists — a wrong username and a wrong password look the same.
export async function loginWithPassword(usernameRaw: string, password: string): Promise<LoginResult> {
  const username = usernameRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    await prisma.auditLog.create({ data: { userName: username || '?', recordType: 'AUTH', recordId: username || '?', action: 'LOGIN_FAILED', newValue: 'unknown username' } });
    return { ok: false, reason: 'bad' };
  }
  if (!user.active) {
    await prisma.auditLog.create({ data: { userId: user.id, userName: user.name, recordType: 'AUTH', recordId: user.id, action: 'LOGIN_FAILED', newValue: 'account deactivated' } });
    return { ok: false, reason: 'inactive' };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    await prisma.auditLog.create({ data: { userId: user.id, userName: user.name, recordType: 'AUTH', recordId: user.id, action: 'LOGIN_FAILED', newValue: `locked, ${minutesLeft} min left` } });
    return { ok: false, reason: 'locked', minutesLeft };
  }
  if (!verifyPassword(password, user.passwordHash)) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
    });
    await prisma.auditLog.create({
      data: { userId: user.id, userName: user.name, recordType: 'AUTH', recordId: user.id, action: 'LOGIN_FAILED', newValue: lock ? `wrong password ×${MAX_FAILED} — locked ${LOCK_MINUTES} min` : `wrong password (${failed}/${MAX_FAILED})` },
    });
    return lock ? { ok: false, reason: 'locked', minutesLeft: LOCK_MINUTES } : { ok: false, reason: 'bad' };
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: user.id, userName: user.name, recordType: 'AUTH', recordId: user.id, action: 'LOGIN' } });
  return { ok: true, userId: user.id, mustChangePassword: user.mustChangePassword };
}
