// Report & batch numbering. Formats are config (Setting table), not code.
import { prisma } from './db';
import { bsYear } from './dates';

const DEFAULT_FORMATS: Record<string, string> = {
  INTAKE: 'SA-{BSYEAR}-{SEQ4}',
  QC: 'QC-{BSYEAR}-{SEQ4}',
  PRODUCTION: 'DP-{BSYEAR}-{SEQ4}',
  BATCH: '{MILL}-{SEQ}',
};

async function getFormat(kind: string): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: `numbering.${kind}` } });
  return s?.value || DEFAULT_FORMATS[kind];
}

async function nextSeq(counterKey: string): Promise<number> {
  const key = `seq.${counterKey}`;
  const row = await prisma.setting.findUnique({ where: { key } });
  const next = (row ? Number(row.value) : 0) + 1;
  await prisma.setting.upsert({ where: { key }, create: { key, value: String(next) }, update: { value: String(next) } });
  return next;
}

export async function nextReportNo(kind: 'INTAKE' | 'QC' | 'PRODUCTION', dateAdIso: string): Promise<string> {
  const year = bsYear(dateAdIso);
  const seq = await nextSeq(`${kind}.${year}`);
  const fmt = await getFormat(kind);
  return fmt
    .replace('{BSYEAR}', String(year))
    .replace('{SEQ4}', String(seq).padStart(4, '0'))
    .replace('{SEQ}', String(seq));
}

// Next batch number for a mill, e.g. RFM-193 → RFM-194
export async function suggestBatchNo(millId: string): Promise<string> {
  const mill = await prisma.mill.findUniqueOrThrow({ where: { id: millId } });
  const fmt = await getFormat('BATCH');
  return fmt.replace('{MILL}', mill.code).replace('{SEQ}', String(mill.batchSeq + 1));
}

export async function claimBatchSeq(millId: string): Promise<void> {
  await prisma.mill.update({ where: { id: millId }, data: { batchSeq: { increment: 1 } } });
}
