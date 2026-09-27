import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card, StatusBadge, DualDate } from '@/components/ui';
import { pendingFor, signedBy, type InboxItem } from '@/lib/inbox';
import { fmtNpt } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const KIND_LABEL = { intake: 'Raw Material Intake', qc: 'Product QC', production: 'Daily Production' } as const;

// Always built from the signed-in user's own session — there is no way to open
// somebody else's Inbox.
export default async function InboxPage() {
  const user = await requireUser();
  const [pending, signed] = await Promise.all([pendingFor(user), signedBy(user)]);
  const mine = pending.filter((i) => !i.stepIn);
  const stepIn = pending.filter((i) => i.stepIn);

  return (
    <Shell user={user} active="/inbox">
      <PageTitle title="My Inbox" subtitle={`Reports waiting for your signature or approval as ${user.roleLabel}, and everything you have signed.`} />

      <Card title={`Waiting for you (${mine.length})`} className="mb-4">
        {mine.length ? <Rows items={mine} /> : <p className="text-sm text-stone-500">Nothing is waiting for your signature. 🎉</p>}
      </Card>

      {stepIn.length > 0 && (
        <Card title={`Admin step-in — waiting on other roles (${stepIn.length})`} className="mb-4">
          <p className="mb-2 text-xs text-stone-500">Admin step-in is on (Admin → Approval matrix), so you could approve these too. They are listed for other roles first.</p>
          <Rows items={stepIn} />
        </Card>
      )}

      <Card title={`Signed by you (${signed.length})`}>
        {signed.length ? <Rows items={signed} signed /> : <p className="text-sm text-stone-500">You haven&apos;t signed any reports yet.</p>}
      </Card>
    </Shell>
  );
}

function Rows({ items, signed = false }: { items: InboxItem[]; signed?: boolean }) {
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {items.map((i) => (
        <li key={`${i.kind}-${i.id}-${i.slot}-${i.action}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">{KIND_LABEL[i.kind]}</span>
          <Link href={`/${i.kind}/${i.id}`} className="font-medium text-brand-700 hover:underline">{i.reportNo}</Link>
          <span className="text-stone-700">{i.what}</span>
          <span className="text-xs text-stone-500"><DualDate ad={i.dateAd} bs={i.dateBs} /></span>
          <StatusBadge status={i.status} />
          <span className="text-xs text-stone-500">
            {signed ? <>signed as <b>{i.slot}</b> · {fmtNpt(i.signedAt!)}</> : <>{i.action === 'APPROVE' ? 'approve as' : 'sign as'} <b>{i.slot}</b></>}
          </span>
          <span className="flex-1" />
          {!signed && (
            <Link href={`/${i.kind}/${i.id}#signoffs`} className="btn-primary !py-1 text-xs">{i.action === 'APPROVE' ? 'Review & approve' : 'Sign'}</Link>
          )}
        </li>
      ))}
    </ul>
  );
}
