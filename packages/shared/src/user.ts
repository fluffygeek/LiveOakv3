import type { Role } from "./roles.js";

export interface UserRecord {
  /** Normalized (lowercased, trimmed) email — the identity key. */
  email: string;
  roles: Role[];
  /** False once revoked; the record is kept for audit history rather than deleted. */
  active: boolean;
  invitedAt: string;
  updatedAt: string;
  /** On the Distribution List for the nightly Discrepancy email. Only valid while roles includes payrollAdministrator or applicationAdministrator. */
  onDistributionList: boolean;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
