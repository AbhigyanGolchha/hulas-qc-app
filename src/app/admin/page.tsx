import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
  const [params, suppliers, users, outboxPending] = await Promise.all([
    prisma.parameter.count({ where: { active: true } }),
    prisma.supplier.count({ where: { active: true } }),
    prisma.user.count({ where: { active: true } }),
    prisma.integrationOutbox.count({ where: { status: 'PENDING' } }),
  ]);
  const items = [
    { href: '/admin/specs', title: 'Parameters & spec limits', desc: `${params} parameters across all templates. Edits are versioned — old reports keep the spec in force when tested.` },
    { href: '/admin/master', title: 'Master data', desc: `Mills, products & shelf life, suppliers (${suppliers}), pack sizes, users (${users}).` },
    { href: '/admin/audit', title: 'Audit log', desc: 'Every submit, approval, unlock and post-submission edit: who, when, old → new.' },
    { href: '/admin/sap', title: 'SAP connection', desc: `Connector settings, connection test, delivery queue (${outboxPending} pending). Mock profile until the SAP team hands over access.` },
    { href: '/admin/outbox', title: 'Integration outbox (payload viewer)', desc: 'Raw SAP-shaped JSON payloads, one per approval.' },
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
