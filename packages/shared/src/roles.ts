export const ROLES = [
  "technician",
  "payrollAdministrator",
  "applicationAdministrator",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
