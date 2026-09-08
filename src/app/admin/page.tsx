import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { getMailConfig, isMailConfigured } from '@/lib/mail';
import { isSapEnabled } from '@/lib/connector';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
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
  const items = [
    { href: '/admin/users', title: 'Users & sign-in', desc: `${users} active accounts. Create accounts, reset passwords, deactivate leavers. (Admin only)` },
    { href: '/admin/notifications', title: 'Notifications (email)', desc: `${isMailConfigured(mailCfg) ? 'Email is ON' : 'Email is OFF — set up SMTP'}${mailFailed ? ` · ${mailFailed} failed` : ''}. Who gets told about submits, approvals, rejections, QC fails, yield warnings.` },
    { href: '/admin/specs', title: 'Parameters & spec limits', desc: `${params} parameters across all templates. Edits are versioned — old reports keep the spec in force when tested.` },
    { href: '/admin/master', title: 'Master data', desc: `Mills & yield bands, products & shelf life, suppliers (${suppliers}), pack sizes.` },
    { href: '/admin/approvals', title: 'Approval flow', desc: 'Who signs off before a report is final — single approval or a multi-step chain per report type.' },
    { href: '/admin/audit', title: 'Audit log', desc: 'Every sign-in, submit, approval, unlock, signature and post-submission edit: who, when, old → new.' },
    ...(sapOn
      ? [
          { href: '/admin/sap', title: 'SAP connection — posting ON', desc: `Connector settings, connection test, delivery queue (${outboxPending} pending${outboxFailed ? `, ${outboxFailed} failed` : ''}).` },
          { href: '/admin/outbox', title: 'Integration outbox (payload viewer)', desc: 'Raw SAP-shaped JSON payloads, one per approval.' },
        ]
      : [{ href: '/admin/sap', title: 'SAP Business One — posting OFF', desc: 'Approved reports are not sent to SAP. The supplier import from SAP still works here. Switch posting on only if you decide it is worth it.' }]),
  ];
  return (
    <Shell user={user} active="/admin">
      <PageTitle title="Admin" subtitle="Master data drives everything — new materials, products or limits need zero code changes." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((it) => (
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
