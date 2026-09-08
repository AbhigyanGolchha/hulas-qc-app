// BS (Bikram Sambat) ↔ AD conversion, Asia/Kathmandu. Works on server and
// client (nepali-date-converter is pure JS, table-driven, covers 2000–2099 BS).
//
// Timezone: the plant runs on Nepal Time (GMT+5:45). next.config.mjs pins the
// Node process to TZ=Asia/Kathmandu so calendar dates stored as local midnight
// mean Nepal midnight; timestamps are always *displayed* through fmtNpt() so a
// browser or server anywhere in the world shows Nepal time.
import NepaliDate from 'nepali-date-converter';

export const NEPAL_TZ = 'Asia/Kathmandu';

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
  return adIso(nowKathmandu());
}

// A Date whose local getters (getHours etc.) read as Nepal wall-clock time,
// whatever the process TZ is. Use only for building calendar dates.
export function nowKathmandu(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: NEPAL_TZ }));
}

// Timestamp for humans, always in Nepal time: "16 Apr 2026, 22:05 NPT".
// Accepts a Date or ISO string; safe to call on server and client.
export function fmtNpt(d: Date | string | null | undefined, opts: { seconds?: boolean; suffix?: boolean } = {}): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  const s = date.toLocaleString('en-GB', {
    timeZone: NEPAL_TZ,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', ...(opts.seconds ? { second: '2-digit' } : {}),
  });
  return opts.suffix === false ? s : `${s} NPT`;
}

// Compact machine-ish form for logs and file names: "2026-04-16 22:05" (Nepal time)
export function fmtNptShort(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NEPAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
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
