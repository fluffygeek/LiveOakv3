import {
  isAllowedWorkspaceDomain,
  isDistributionListEligibleRole,
  normalizeEmail,
  type Role,
  type UserRecord,
} from "@liveoakv3/shared";
import {
  AccessDeniedError,
  ForbiddenError,
  InvalidArgumentError,
  LastAdministratorError,
  NotAllowlistedError,
  UserNotFoundError,
} from "./errors.ts";
import type { UserRepository } from "./userRepository.ts";

export interface AccessContext {
  allowedWorkspaceDomain: string;
}

export interface ResolvedAccess {
  email: string;
  roles: Role[];
}

const defaultNow = () => new Date().toISOString();

function dedupeRoles(roles: Role[]): Role[] {
  return [...new Set(roles)];
}

function requireApplicationAdministrator(callerRoles: Role[]): void {
  if (!callerRoles.includes("applicationAdministrator")) {
    throw new ForbiddenError(
      "Only an Application Administrator can perform this action",
    );
  }
}

function isActiveAdministrator(user: UserRecord): boolean {
  return user.active && user.roles.includes("applicationAdministrator");
}

/** True when `existing` currently holds the admin role and `nextRoles` would drop it. */
function wouldLoseAdministratorRole(
  existing: UserRecord | null,
  nextRoles: Role[],
): boolean {
  return (
    existing !== null &&
    isActiveAdministrator(existing) &&
    !nextRoles.includes("applicationAdministrator")
  );
}

async function assertAnotherActiveAdministratorRemains(
  repo: UserRepository,
  excludingEmail: string,
): Promise<void> {
  const users = await repo.listUsers();
  const remaining = users.filter(
    (user) => user.email !== excludingEmail && isActiveAdministrator(user),
  );
  if (remaining.length === 0) {
    throw new LastAdministratorError(
      `${excludingEmail} is the last active Application Administrator`,
    );
  }
}

/** Checks Workspace-domain membership and allowlist status, then resolves the caller's roles. */
export async function resolveAccess(
  repo: UserRepository,
  ctx: AccessContext,
  callerEmail: string,
): Promise<ResolvedAccess> {
  const email = normalizeEmail(callerEmail);
  if (!isAllowedWorkspaceDomain(email, ctx.allowedWorkspaceDomain)) {
    throw new AccessDeniedError(`${email} is not on the allowed Workspace domain`);
  }
  const record = await repo.getUser(email);
  if (!record || !record.active) {
    throw new NotAllowlistedError(`${email} has not been invited`);
  }
  return { email, roles: record.roles };
}

/** Creates a new allowlist entry, or updates roles if the email was already invited. */
export async function inviteUser(
  repo: UserRepository,
  callerRoles: Role[],
  targetEmail: string,
  roles: Role[],
  now: () => string = defaultNow,
): Promise<UserRecord> {
  requireApplicationAdministrator(callerRoles);
  const email = normalizeEmail(targetEmail);
  const existing = await repo.getUser(email);
  if (wouldLoseAdministratorRole(existing, roles)) {
    await assertAnotherActiveAdministratorRemains(repo, email);
  }
  const timestamp = now();
  const record: UserRecord = {
    email,
    roles: dedupeRoles(roles),
    active: true,
    invitedAt: existing?.invitedAt ?? timestamp,
    updatedAt: timestamp,
    onDistributionList: existing?.onDistributionList ?? false,
  };
  await repo.putUser(record);
  return record;
}

export async function updateUserRoles(
  repo: UserRepository,
  callerRoles: Role[],
  targetEmail: string,
  roles: Role[],
  now: () => string = defaultNow,
): Promise<UserRecord> {
  requireApplicationAdministrator(callerRoles);
  const email = normalizeEmail(targetEmail);
  const existing = await repo.getUser(email);
  if (!existing) {
    throw new UserNotFoundError(`${email} has not been invited`);
  }
  if (wouldLoseAdministratorRole(existing, roles)) {
    await assertAnotherActiveAdministratorRemains(repo, email);
  }
  const record: UserRecord = {
    ...existing,
    roles: dedupeRoles(roles),
    updatedAt: now(),
    // Backfills records written before onDistributionList existed — Firestore
    // doesn't enforce the TS type, so a pre-existing doc may lack the field
    // at runtime despite existing satisfying UserRecord at compile time.
    onDistributionList: existing.onDistributionList ?? false,
  };
  await repo.putUser(record);
  return record;
}

export async function revokeUser(
  repo: UserRepository,
  callerRoles: Role[],
  targetEmail: string,
  now: () => string = defaultNow,
): Promise<void> {
  requireApplicationAdministrator(callerRoles);
  const email = normalizeEmail(targetEmail);
  const existing = await repo.getUser(email);
  if (!existing) {
    throw new UserNotFoundError(`${email} has not been invited`);
  }
  if (isActiveAdministrator(existing)) {
    await assertAnotherActiveAdministratorRemains(repo, email);
  }
  await repo.putUser({
    ...existing,
    active: false,
    updatedAt: now(),
    onDistributionList: existing.onDistributionList ?? false,
  });
}

/** Distribution List membership is limited to existing Payroll/Application Administrator users — never an arbitrary address. */
export async function setDistributionListMembership(
  repo: UserRepository,
  callerRoles: Role[],
  targetEmail: string,
  onDistributionList: boolean,
  now: () => string = defaultNow,
): Promise<UserRecord> {
  requireApplicationAdministrator(callerRoles);
  const email = normalizeEmail(targetEmail);
  const existing = await repo.getUser(email);
  if (!existing) {
    throw new UserNotFoundError(`${email} has not been invited`);
  }
  if (onDistributionList && !isDistributionListEligibleRole(existing.roles)) {
    throw new InvalidArgumentError(
      `${email} must hold the Payroll Administrator or Application Administrator role to join the Distribution List`,
    );
  }
  const record: UserRecord = { ...existing, onDistributionList, updatedAt: now() };
  await repo.putUser(record);
  return record;
}

export async function listUsers(
  repo: UserRepository,
  callerRoles: Role[],
): Promise<UserRecord[]> {
  requireApplicationAdministrator(callerRoles);
  return repo.listUsers();
}
