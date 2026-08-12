import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  inviteUser as inviteUserService,
  listUsers as listUsersService,
  resolveAccess,
  revokeUser as revokeUserService,
  updateUserRoles as updateUserRolesService,
  type ResolvedAccess,
} from "./access/accessService.js";
import {
  AccessDeniedError,
  ForbiddenError,
  InvalidArgumentError,
  LastAdministratorError,
  NotAllowlistedError,
  UserNotFoundError,
} from "./access/errors.js";
import { FirestoreUserRepository } from "./access/firestoreUserRepository.js";
import { parseEmail, parseRoles } from "./access/validation.js";

initializeApp();

// Placeholder until a real Workspace domain is configured for deployment.
const ALLOWED_WORKSPACE_DOMAIN =
  process.env.ALLOWED_WORKSPACE_DOMAIN ?? "example.com";

function repository(): FirestoreUserRepository {
  return new FirestoreUserRepository(getFirestore());
}

function toHttpsError(error: unknown): HttpsError {
  if (error instanceof AccessDeniedError || error instanceof NotAllowlistedError) {
    return new HttpsError("permission-denied", error.message);
  }
  if (error instanceof ForbiddenError) {
    return new HttpsError("permission-denied", error.message);
  }
  if (error instanceof LastAdministratorError) {
    return new HttpsError("failed-precondition", error.message);
  }
  if (error instanceof UserNotFoundError) {
    return new HttpsError("not-found", error.message);
  }
  if (error instanceof InvalidArgumentError) {
    return new HttpsError("invalid-argument", error.message);
  }
  return new HttpsError("internal", "Unexpected error");
}

async function requireCaller(
  auth: CallableRequest["auth"],
): Promise<ResolvedAccess> {
  const email = auth?.token.email;
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign-in required");
  }
  return resolveAccess(
    repository(),
    { allowedWorkspaceDomain: ALLOWED_WORKSPACE_DOMAIN },
    email,
  );
}

/** Called by the mobile/web clients right after sign-in to learn the caller's roles (or that they're denied). */
export const resolveMyAccess = onCall(async (request) => {
  try {
    return await requireCaller(request.auth);
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const inviteUser = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const data = request.data as Record<string, unknown>;
    const email = parseEmail(data.email);
    const roles = parseRoles(data.roles);
    return await inviteUserService(repository(), caller.roles, email, roles);
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const updateUserRoles = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const data = request.data as Record<string, unknown>;
    const email = parseEmail(data.email);
    const roles = parseRoles(data.roles);
    return await updateUserRolesService(repository(), caller.roles, email, roles);
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const revokeUser = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const data = request.data as Record<string, unknown>;
    const email = parseEmail(data.email);
    await revokeUserService(repository(), caller.roles, email);
    return { revoked: true };
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const listUsers = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    return await listUsersService(repository(), caller.roles);
  } catch (error) {
    throw toHttpsError(error);
  }
});
