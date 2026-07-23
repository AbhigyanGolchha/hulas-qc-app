// Spec evaluation engine — shared by server and client (pure, no deps).
// A blank value is "not tested", never a fail and never coerced to 0.

export type SpecLike = {
  operator: string;
  min: number | null;
  max: number | null;
  textExpected?: string | null;
};

export type EvalStatus = 'PASS' | 'FAIL' | null;

export function evaluateNumeric(spec: SpecLike, value: number | null | undefined): EvalStatus {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  switch (spec.operator) {
    case 'LTE':
      return spec.max === null ? null : value <= spec.max ? 'PASS' : 'FAIL';
    case 'LT':
      // "< 0.0%" on the paper forms means nil — a stored max of 0 passes only 0
      if (spec.max === null) return null;
      if (spec.max === 0) return value <= 0 ? 'PASS' : 'FAIL';
      return value < spec.max ? 'PASS' : 'FAIL';
    case 'GTE':
      return spec.min === null ? null : value >= spec.min ? 'PASS' : 'FAIL';
    case 'GT':
      return spec.min === null ? null : value > spec.min ? 'PASS' : 'FAIL';
    case 'RANGE':
      if (spec.min === null || spec.max === null) return null;
      return value >= spec.min && value <= spec.max ? 'PASS' : 'FAIL';
    case 'NIL':
      return value === 0 ? 'PASS' : 'FAIL';
    case 'RECORD':
      return null; // record-only, no pass/fail
    default:
      return null;
  }
}

export function evaluateText(spec: SpecLike, value: string | null | undefined): EvalStatus {
  if (!value || !value.trim()) return null;
  if (spec.operator === 'TEXT_MATCH' && spec.textExpected) {
    return value.trim().toLowerCase() === spec.textExpected.trim().toLowerCase() ? 'PASS' : 'FAIL';
  }
  return null;
}

export function evaluate(
  spec: SpecLike,
  valueType: string,
  valueNum: number | null | undefined,
  valueText: string | null | undefined,
): EvalStatus {
  if (valueType === 'NUMBER') return evaluateNumeric(spec, valueNum);
  return evaluateText(spec, valueText);
}

// Average of provided samples (ignores blanks). Returns null if none entered.
export function sampleAverage(samples: Array<number | null | undefined>): number | null {
  const vals = samples.filter((s): s is number => s !== null && s !== undefined && !Number.isNaN(s));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
}

// Overall PASS/FAIL suggestion: FAIL if any evaluated row fails; PASS if at
// least one row passes and none fail; null if nothing evaluated yet.
export function suggestOverall(statuses: EvalStatus[]): 'PASS' | 'FAIL' | null {
  if (statuses.some((s) => s === 'FAIL')) return 'FAIL';
  if (statuses.some((s) => s === 'PASS')) return 'PASS';
  return null;
}
