import { defineCallable, repository } from "../callableHandler.js";
import {
  inviteUser as inviteUserService,
  listUsers as listUsersService,
  revokeUser as revokeUserService,
  setDistributionListMembership as setDistributionListMembershipService,
  updateUserRoles as updateUserRolesService,
} from "./accessService.js";
import { parseEmail, parseOnDistributionList, parseRoles } from "./validation.js";

/** Called by the mobile/web clients right after sign-in to learn the caller's roles (or that they're denied). */
export const resolveMyAccess = defineCallable({
  handle: async (caller) => caller,
});

export const inviteUser = defineCallable({
  parse: (data) => {
    const record = data as Record<string, unknown>;
    return { email: parseEmail(record.email), roles: parseRoles(record.roles) };
  },
  handle: (caller, { email, roles }) =>
    inviteUserService(repository(), caller.roles, email, roles),
});

export const updateUserRoles = defineCallable({
  parse: (data) => {
    const record = data as Record<string, unknown>;
    return { email: parseEmail(record.email), roles: parseRoles(record.roles) };
  },
  handle: (caller, { email, roles }) =>
    updateUserRolesService(repository(), caller.roles, email, roles),
});

export const revokeUser = defineCallable({
  parse: (data) => parseEmail((data as Record<string, unknown>).email),
  handle: async (caller, email) => {
    await revokeUserService(repository(), caller.roles, email);
    return { revoked: true };
  },
});

export const listUsers = defineCallable({
  handle: (caller) => listUsersService(repository(), caller.roles),
});

export const setDistributionListMembership = defineCallable({
  parse: (data) => {
    const record = data as Record<string, unknown>;
    return {
      email: parseEmail(record.email),
      onDistributionList: parseOnDistributionList(record.onDistributionList),
    };
  },
  handle: (caller, { email, onDistributionList }) =>
    setDistributionListMembershipService(repository(), caller.roles, email, onDistributionList),
});
