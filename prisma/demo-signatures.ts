// Demo e-signatures: a cursive SVG data-URI per user, and Signature rows for
// records that are already SUBMITTED/APPROVED so prints and panels look
// complete. Shared by seed.ts (fresh installs) and the backfill script.
// Real users replace these by drawing their own on /profile.
import type { PrismaClient } from '@prisma/client';

export function cursiveSignature(name: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="70"><text x="10" y="46" font-family="'Snell Roundhand','Segoe Script','Brush Script MT',cursive" font-style="italic" font-size="30" fill="#1c2f80">${name}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const SLOT_SETS: Record<string, { preparers: [string, string][]; approver: string }> = {
  // recordType → [slot, signer role hint][], approver slot
  INTAKE: { preparers: [['Godown Keeper', 'GODOWN'], ['Quality Controller', 'QC']], approver: 'Manager' },
  QC: { preparers: [['Checked by', 'QC']], approver: 'Approved by (GM)' },
  PRODUCTION: { preparers: [['Prepared by', 'SUPERVISOR']], approver: 'Approved by' },
};

export async function seedDemoSignatures(prisma: PrismaClient) {
  // 1) every user gets a starter signature (only if they haven't drawn one)
  const users = await prisma.user.findMany();
  for (const u of users) {
    if (!u.signatureData) {
      await prisma.user.update({ where: { id: u.id }, data: { signatureData: cursiveSignature(u.name) } });
    }
  }
  const byRole = (role: string, millId?: string | null) =>
    users.find((u) => u.role === role && (role !== 'SUPERVISOR' || !millId || u.millId === millId));

  // 2) signature rows for non-draft demo records
  async function ensure(recordType: string, recordId: string, slot: string, signer: { id: string; name: string } | undefined, at: Date) {
    if (!signer) return;
    const sig = cursiveSignature(signer.name);
    await prisma.signature.upsert({
      where: { recordType_recordId_slot: { recordType, recordId, slot } },
      create: { recordType, recordId, slot, userId: signer.id, userName: signer.name, imageData: sig, signedAt: at },
      update: {},
    });
  }

  const intakes = await prisma.intakeReport.findMany({ where: { status: { in: ['SUBMITTED', 'APPROVED'] } } });
  for (const r of intakes) {
    for (const [slot, role] of SLOT_SETS.INTAKE.preparers) await ensure('INTAKE', r.id, slot, byRole(role), r.dateAd);
    if (r.status === 'APPROVED') await ensure('INTAKE', r.id, SLOT_SETS.INTAKE.approver, byRole('MANAGER'), r.approvedAt ?? r.dateAd);
  }
  const qcs = await prisma.qcReport.findMany({ where: { status: { in: ['SUBMITTED', 'APPROVED'] } } });
  for (const r of qcs) {
    for (const [slot, role] of SLOT_SETS.QC.preparers) await ensure('QC', r.id, slot, byRole(role), r.dateAd);
    if (r.status === 'APPROVED') await ensure('QC', r.id, SLOT_SETS.QC.approver, byRole('MANAGER'), r.approvedAt ?? r.dateAd);
  }
  const prods = await prisma.productionReport.findMany({ where: { status: { in: ['SUBMITTED', 'APPROVED'] } } });
  for (const r of prods) {
    for (const [slot, role] of SLOT_SETS.PRODUCTION.preparers) await ensure('PRODUCTION', r.id, slot, byRole(role, r.millId), r.dateAd);
    if (r.status === 'APPROVED') await ensure('PRODUCTION', r.id, SLOT_SETS.PRODUCTION.approver, byRole('MANAGER'), r.approvedAt ?? r.dateAd);
  }
}
