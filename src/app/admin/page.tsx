import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { getMailConfig, isMailConfigured } from '@/lib/mail';
import { isSapEnabled } from '@/lib/connector';
import { openResetRequests } from '@/lib/password-reset';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const user = await requirePermission('admin.panel');
  const [params, suppliers, users, outboxPending, outboxFailed, mailFailed, mailCfg, sapOn] = await Promise.all([
    prisma.parameter.count({ where: { active: true } }),
    prisma.supplier.count({ where: { active: true } }),
    prisma.user.count({ where: { active: true } }),
    prisma.integrationOutbox.count({ where: { status: 'PENDING' } }),
    prisma.integrationOutbox.count({ where: { status: 'FAILED' } }),
    prisma.notification.count({ where: { status: 'FAILED' } }),
    getMailConfig(),
    isSapEnabled(),
  ]);
  const resetAsks = (await openResetRequests()).size;
  const items: { href: string; title: string; desc: string; perm: string }[] = [
    { perm: 'admin.users', href: '/admin/users', title: 'Users & sign-in', desc: `${resetAsks ? `⚠ ${resetAsks} waiting for a password reset · ` : ''}${users} active accounts. Create accounts, reset passwords, deactivate or delete leavers.` },
    { perm: 'admin.users', href: '/admin/roles', title: 'Roles & permissions', desc: 'Create roles and tick what each may do — reports, deleting, each Admin page. The approval matrix then picks from these roles.' },
    { perm: 'admin.notifications', href: '/admin/notifications', title: 'Notifications (email)', desc: `${isMailConfigured(mailCfg) ? 'Email is ON' : 'Email is OFF — set up SMTP'}${mailFailed ? ` · ${mailFailed} failed` : ''}. Who gets told about submits, approvals, rejections, QC fails, yield warnings.` },
    { perm: 'admin.specs', href: '/admin/specs', title: 'Parameters & spec limits', desc: `${params} parameters across all templates. Edits are versioned — old reports keep the spec in force when tested.` },
    { perm: 'admin.master', href: '/admin/master', title: 'Master data', desc: `Mills & yield bands, products & shelf life, suppliers (${suppliers}), pack sizes.` },
    { perm: 'admin.matrix', href: '/admin/approvals', title: 'Approval matrix', desc: 'Per report type: who signs off, who approves in which order, who may unlock — nothing is built in.' },
    { perm: 'admin.audit', href: '/admin/audit', title: 'Audit log', desc: 'Every sign-in (with IP address), submit, approval, unlock, signature, deletion and post-submission edit: who, when, old → new.' },
    ...(sapOn
      ? [
          { perm: 'admin.sap', href: '/admin/sap', title: 'SAP connection — posting ON', desc: `Connector settings, connection test, delivery queue (${outboxPending} pending${outboxFailed ? `, ${outboxFailed} failed` : ''}).` },
          { perm: 'admin.sap', href: '/admin/outbox', title: 'Integration outbox (payload viewer)', desc: 'Raw SAP-shaped JSON payloads, one per approval.' },
        ]
      : [{ perm: 'admin.sap', href: '/admin/sap', title: 'SAP Business One — posting OFF', desc: 'Approved reports are not sent to SAP. The supplier import from SAP still works here. Switch posting on only if you decide it is worth it.' }]),
  ];
  return (
    <Shell user={user} active="/admin">
      <PageTitle title="Admin" subtitle="Master data drives everything — new materials, products or limits need zero code changes." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.filter((it) => user.permissions.includes(it.perm)).map((it) => (
          <Link key={it.href} href={it.href}>
            <Card className="h-full transition-colors hover:border-brand-500">
              <div className="font-semibold text-brand-700">{it.title}</div>
              <div className="mt-1 text-sm text-stone-500">{it.desc}</div>
            </Card>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
