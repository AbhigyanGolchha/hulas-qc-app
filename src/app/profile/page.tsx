import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { PageTitle, Card } from '@/components/ui';
import { ProfileSignature } from './profile-signature';
import { ROLE_LABELS, type Role } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requireUser();
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  return (
    <Shell user={user} active="/profile">
      <PageTitle
        title="My profile"
        subtitle={`${user.name} · ${ROLE_LABELS[user.role as Role] ?? user.role}`}
      />
      <Card title="My signature" className="max-w-xl">
        <p className="mb-3 text-sm text-stone-500">
          Drawn once, used everywhere: every report you submit, sign or approve is stamped with this
          signature plus your name and the exact time. No more signing paper copies.
        </p>
        <ProfileSignature current={dbUser.signatureData} />
      </Card>
    </Shell>
  );
}
