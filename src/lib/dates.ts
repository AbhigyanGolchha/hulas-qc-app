// BS (Bikram Sambat) ↔ AD conversion, Asia/Kathmandu. Works on server and
// client (nepali-date-converter is pure JS, table-driven, covers 2000–2099 BS).
import NepaliDate from 'nepali-date-converter';

const BS_MONTHS = [
  'Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

// "YYYY-MM-DD" (AD) → "YYYY-MM-DD" (BS)
export function adToBs(adIso: string): string {
  const [y, m, d] = adIso.split('-').map(Number);
  if (!y || !m || !d) return '';
  try {
    const nd = new NepaliDate(new Date(y, m - 1, d));
    return `${nd.getYear()}-${pad(nd.getMonth() + 1)}-${pad(nd.getDate())}`;
  } catch {
    return '';
  }
}

// "YYYY-MM-DD" (BS) → "YYYY-MM-DD" (AD)
export function bsToAd(bsIso: string): string {
  const [y, m, d] = bsIso.split('-').map(Number);
  if (!y || !m || !d) return '';
  try {
    const js = new NepaliDate(y, m - 1, d).toJsDate();
    return `${js.getFullYear()}-${pad(js.getMonth() + 1)}-${pad(js.getDate())}`;
  } catch {
    return '';
  }
}

// Display like the paper form: "3-1-2083" (Miti, D-M-YYYY)
export function formatMiti(bsIso: string): string {
  const [y, m, d] = bsIso.split('-').map(Number);
  if (!y || !m || !d) return bsIso || '—';
  return `${d}-${m}-${y}`;
}

export function formatBsLong(bsIso: string): string {
  const [y, m, d] = bsIso.split('-').map(Number);
  if (!y || !m || !d) return bsIso || '—';
  return `${d} ${BS_MONTHS[m - 1]} ${y} BS`;
}

// "16-April-2026" like the paper form
export function formatAdLong(ad: Date | string): string {
  const d = typeof ad === 'string' ? new Date(ad + 'T00:00:00') : ad;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

export function adIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Today in Asia/Kathmandu regardless of server TZ
export function todayKathmandu(): string {
  const now = new Date();
  const kt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }));
  return adIso(kt);
}

export function addDays(adIsoStr: string, days: number): string {
  const [y, m, d] = adIsoStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return adIso(dt);
}

// BS year for numbering (SA-2083-0001)
export function bsYear(adIsoStr: string): number {
  const bs = adToBs(adIsoStr);
  return Number(bs.split('-')[0]) || new Date().getFullYear();
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
