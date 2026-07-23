export const ROLES = ['ADMIN', 'MANAGER', 'QC', 'SUPERVISOR', 'GODOWN'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager / GM',
  QC: 'QC Analyst',
  SUPERVISOR: 'Production Supervisor',
  GODOWN: 'Godown Keeper',
};

export const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const DECISIONS = {
  ACCEPTED: 'Accepted',
  ACCEPTED_DEDUCTION: 'Accepted with deduction',
  REJECTED: 'Rejected',
} as const;
export type Decision = keyof typeof DECISIONS;

// Spec operators — see src/lib/spec.ts for evaluation semantics
export const OPERATORS = ['LTE', 'LT', 'GTE', 'GT', 'RANGE', 'NIL', 'RECORD', 'TEXT_MATCH'] as const;
export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  LTE: '≤ max',
  LT: '< max',
  GTE: '≥ min',
  GT: '> min',
  RANGE: 'min – max',
  NIL: 'must be nil (0)',
  RECORD: 'record only (no pass/fail)',
  TEXT_MATCH: 'text must match',
};

export const SOURCE_TAGS = {
  INTERNAL: '⚙ internal (Hulas form)',
  REFERENCE: '📖 reference (published standard — verify vs Nepal NS/DFTQC)',
} as const;

export const BAG_TYPES = ['jute', 'PP'] as const;

export const SEASONS = ['Chait', 'Baishak', 'Jesth', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun'];

export const DOWNTIME_DEPARTMENTS = ['Product In', 'Product Out', 'Electrical', 'Mechanical', 'Power cut', 'Break', 'Others'];

export const UNLOADING_PLACES = ['Maida Intake', 'Chakki Mill Godown', 'Chiura Mill Godown', 'Bhuja Mill Godown', 'Main Godown'];

export function canApprove(role: string) {
  return role === 'MANAGER' || role === 'ADMIN';
}
export function canUnlock(role: string) {
  return role === 'MANAGER' || role === 'ADMIN';
}
export function isAdmin(role: string) {
  return role === 'ADMIN';
}
