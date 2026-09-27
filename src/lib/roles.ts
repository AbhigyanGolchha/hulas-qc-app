// Roles are data, not code: Admin → Roles & permissions creates roles and
// ticks what each may do. Stored in Setting `roles` (seeded once by the data
// fix in src/lib/data-fixes.ts with the roles the app shipped with).
//
// The one fixed point is the ADMIN role: it always has every permission and
// cannot be edited or deleted — otherwise a single mis-click could lock
// everyone out of the Admin panel for good.
//
// What a role may SIGN or APPROVE is not a permission here — that is the
// approval matrix (Admin → Approval matrix), which picks roles from this list.
import { prisma } from './db';

export const PERMISSIONS: Record<string, { label: string; group: string }> = {
  'intake.edit': { label: 'Raw Material Intake — create & fill in reports', group: 'Reports' },
  'qc.edit': { label: 'Product QC — create & fill in sheets', group: 'Reports' },
  'production.edit': { label: 'Daily Production — create & fill in reports', group: 'Reports' },
  'reports.delete': { label: 'Delete reports (one at a time or several at once)', group: 'Reports' },
  'admin.panel': { label: 'Open the Admin panel', group: 'Admin' },
  'admin.users': { label: 'Users, roles & sign-in (create, reset, delete users; edit roles)', group: 'Admin' },
  'admin.matrix': { label: 'Approval matrix', group: 'Admin' },
  'admin.specs': { label: 'Parameters & spec limits', group: 'Admin' },
  'admin.master': { label: 'Master data (mills, products, suppliers, pack sizes)', group: 'Admin' },
  'admin.notifications': { label: 'Email notifications', group: 'Admin' },
  'admin.audit': { label: 'Audit log', group: 'Admin' },
  'admin.sap': { label: 'SAP connection & integration outbox', group: 'Admin' },
};
export type Permission = keyof typeof PERMISSIONS;

export type RoleDef = { key: string; label: string; permissions: string[] };

export const SUPER_ROLE = 'ADMIN';
const KEY = 'roles';

export async function getRoles(): Promise<RoleDef[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  let roles: RoleDef[] = [];
  try {
    roles = row ? JSON.parse(row.value) : [];
  } catch {
    roles = [];
  }
  // the super role always exists and always has everything
  const admin = roles.find((r) => r.key === SUPER_ROLE);
  const rest = roles.filter((r) => r.key !== SUPER_ROLE);
  return [{ key: SUPER_ROLE, label: admin?.label ?? 'Admin', permissions: Object.keys(PERMISSIONS) }, ...rest];
}

export async function saveRoles(roles: RoleDef[]) {
  const value = JSON.stringify(roles.map((r) => (r.key === SUPER_ROLE ? { ...r, permissions: Object.keys(PERMISSIONS) } : r)));
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export async function roleLabels(): Promise<Record<string, string>> {
  return Object.fromEntries((await getRoles()).map((r) => [r.key, r.label]));
}

export async function roleLabel(key: string): Promise<string> {
  if (key === 'ANY') return 'anyone who can edit the report';
  return (await roleLabels())[key] ?? key;
}

export async function permissionsFor(roleKey: string): Promise<string[]> {
  return (await getRoles()).find((r) => r.key === roleKey)?.permissions ?? [];
}

export function can(user: { permissions: string[] } | null | undefined, perm: Permission): boolean {
  return Boolean(user?.permissions.includes(perm));
}

// A sign-off slot or approval step may belong to several roles, stored as
// "QC,MANAGER" ('ANY' = anyone who can edit the report).
export function roleSet(v: string | null | undefined): string[] {
  return (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}
export function hasRole(v: string | null | undefined, role: string): boolean {
  const set = roleSet(v);
  return set.includes('ANY') || set.includes(role);
}
export async function roleListLabel(v: string | null | undefined): Promise<string> {
  const set = roleSet(v);
  if (set.includes('ANY')) return 'anyone who can edit the report';
  const labels = await roleLabels();
  return set.map((k) => labels[k] ?? k).join(' or ') || '—';
}
