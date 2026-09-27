// Company name printed at the top of every report (Admin → Master data).
import { prisma } from './db';

export const DEFAULT_COMPANY = 'Hulas Khadya Udhyog Ltd.';

export async function companyName(): Promise<string> {
  return (await prisma.setting.findUnique({ where: { key: 'company.name' } }))?.value || DEFAULT_COMPANY;
}
