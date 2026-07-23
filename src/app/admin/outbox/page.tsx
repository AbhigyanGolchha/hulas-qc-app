import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OutboxPage() {
  const user = await requireUser();
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') redirect('/');
  const items = await prisma.integrationOutbox.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return (
    <Shell user={user} active="/admin">
      <PageTitle
        title="Integration outbox"
        subtitle="Every approval drops a SAP-shaped JSON payload here (QM inspection lots, production order confirmations). A future connector consumes this queue — nothing leaves the building today."
      />
      <div className="space-y-3">
        {items.map((i) => (
          <details key={i.id} className="rounded-xl border border-stone-200 bg-white p-3 text-sm">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{i.recordType}</span>
              <span className="text-xs text-stone-500">{i.createdAt.toISOString().replace('T', ' ').slice(0, 19)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${i.status === 'PENDING' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>{i.status}</span>
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-stone-50 p-3 text-xs">{JSON.stringify(JSON.parse(i.payload), null, 2)}</pre>
          </details>
        ))}
        {!items.length && <p className="text-sm text-stone-400">Empty — approve a record and its payload lands here.</p>}
      </div>
    </Shell>
  );
}
