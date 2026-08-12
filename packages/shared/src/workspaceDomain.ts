import { normalizeEmail } from "./user.js";

/** Sign-in is restricted to accounts on the company's Google Workspace domain (ADR-0001). */
export function isAllowedWorkspaceDomain(
  email: string,
  allowedDomain: string,
): boolean {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = normalized.slice(atIndex + 1);
  return domain === allowedDomain.trim().toLowerCase();
}
