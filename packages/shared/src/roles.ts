export const ROLES = [
  "technician",
  "payrollAdministrator",
  "applicationAdministrator",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Distribution List membership (spec #6) is limited to these roles — the single source of truth shared by server validation, the nightly email's recipient filter, and the web UI's toggle. */
export function isDistributionListEligibleRole(roles: Role[]): boolean {
  return roles.includes("payrollAdministrator") || roles.includes("applicationAdministrator");
}
