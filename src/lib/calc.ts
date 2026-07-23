// Pure calculation helpers shared by client forms, server, and print views.

// "HH:MM" pair → minutes, handling overnight (22:00 → 06:00 = 480)
export function shiftMinutes(start?: string | null, close?: string | null): number | null {
  const s = parseHm(start);
  const c = parseHm(close);
  if (s === null || c === null) return null;
  let diff = c - s;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

export function durationMinutes(from?: string | null, to?: string | null): number | null {
  return shiftMinutes(from, to);
}

function parseHm(t?: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return `${h} hr ${m ? m + ' min' : ''}`.trim();
}

// Efficiency % = production time / shift time
export function efficiencyPct(shiftMin: number | null, breakdownMin: number | null): number | null {
  if (shiftMin === null || !shiftMin) return null;
  const prod = shiftMin - (breakdownMin ?? 0);
  return round2((prod / shiftMin) * 100);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtKg(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

export function fmtPct(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(dp) + '%';
}

// Production row total = semi-finished + Σ packed kg
export function rowTotalKg(semiFinishedKg: number | null | undefined, packedKg: Record<string, number>): number {
  const packed = Object.values(packedKg).reduce((a, b) => a + (b || 0), 0);
  return (semiFinishedKg || 0) + packed;
}

export function parsePacked(json?: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

// ---------- Purchase value & deductions (intake) ----------
// Price is entered ₨ per quintal (100 kg). Deductions can be any mix of:
// weight cut (katti, kg off the payable weight), price cut (₨/quintal off the
// rate), and a flat ₨ amount. Effective rate = what the lot truly cost per
// quintal received — this is what SAP prices the GRPO at.
export type IntakeValue = {
  grossValue: number | null;
  payableWeightKg: number | null;
  totalDeduction: number | null;
  payableValue: number | null;
  effectiveRatePerQuintal: number | null;
};
export function intakeValue(args: {
  weightKg: number | null;
  pricePerQuintal: number | null;
  weightCutKg?: number | null;
  priceCutPerQuintal?: number | null;
  flatDeduction?: number | null;
}): IntakeValue {
  const w = args.weightKg, p = args.pricePerQuintal;
  if (w === null || w === undefined || !p) {
    const payableW = w !== null && w !== undefined ? Math.max(0, w - (args.weightCutKg ?? 0)) : null;
    return { grossValue: null, payableWeightKg: payableW, totalDeduction: null, payableValue: null, effectiveRatePerQuintal: null };
  }
  const gross = round2((w / 100) * p);
  const payableW = Math.max(0, w - (args.weightCutKg ?? 0));
  const rate = Math.max(0, p - (args.priceCutPerQuintal ?? 0));
  const payable = round2(Math.max(0, (payableW / 100) * rate - (args.flatDeduction ?? 0)));
  return {
    grossValue: gross,
    payableWeightKg: payableW,
    totalDeduction: round2(gross - payable),
    payableValue: payable,
    effectiveRatePerQuintal: w > 0 ? round2(payable / (w / 100)) : null,
  };
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return '₨ ' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export type YieldCheck = {
  totalRecoveryPct: number | null;
  mainYieldPct: number | null;
  warnings: string[];
};

export function checkYields(
  netInputKg: number,
  totalOutputKg: number,
  mainProductKg: number,
  limits: { totalRecoveryMin?: number | null; totalRecoveryMax?: number | null; mainYieldMin?: number | null; mainYieldMax?: number | null },
): YieldCheck {
  if (!netInputKg) return { totalRecoveryPct: null, mainYieldPct: null, warnings: [] };
  const total = round2((totalOutputKg / netInputKg) * 100);
  const main = round2((mainProductKg / netInputKg) * 100);
  const warnings: string[] = [];
  if (limits.totalRecoveryMin != null && total < limits.totalRecoveryMin)
    warnings.push(`Total recovery ${total}% is below the expected minimum of ${limits.totalRecoveryMin}% — check for missing output rows or a wrong input weight.`);
  if (limits.totalRecoveryMax != null && total > limits.totalRecoveryMax)
    warnings.push(`Total recovery ${total}% is above the expected maximum of ${limits.totalRecoveryMax}% — output can't exceed input by this much; check the weights.`);
  if (limits.mainYieldMin != null && main < limits.mainYieldMin)
    warnings.push(`Main-product yield ${main}% is below the usual ${limits.mainYieldMin}%.`);
  if (limits.mainYieldMax != null && main > limits.mainYieldMax)
    warnings.push(`Main-product yield ${main}% is above the usual ${limits.mainYieldMax}%.`);
  return { totalRecoveryPct: total, mainYieldPct: main, warnings };
}
