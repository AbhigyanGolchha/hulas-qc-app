// The current user's stored signature (drawn once, stamped on every sign-off).
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { signatureData: true } });
  return NextResponse.json({ signatureData: dbUser?.signatureData ?? null });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { imageData } = await req.json();
  if (imageData !== null) {
    if (typeof imageData !== 'string' || !imageData.startsWith('data:image/png;base64,')) {
      return NextResponse.json({ error: 'Expected a PNG data URI' }, { status: 400 });
    }
    if (imageData.length > 300_000) {
      return NextResponse.json({ error: 'Signature image too large' }, { status: 400 });
    }
  }
  await prisma.user.update({ where: { id: user.id }, data: { signatureData: imageData } });
  await logAudit(user, 'MASTER', user.id, 'UPDATE', 'user.signature', null, imageData ? 'signature drawn/updated' : 'signature cleared');
  return NextResponse.json({ ok: true });
}
