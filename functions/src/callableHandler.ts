import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { resolveAccess, type ResolvedAccess } from "./access/accessService.ts";
import {
  AccessDeniedError,
  DiscrepancyActiveError,
  ForbiddenError,
  InvalidArgumentError,
  JobRecordNotFoundError,
  LastAdministratorError,
  NotAllowlistedError,
  NotDuplicateError,
  UserNotFoundError,
} from "./access/errors.ts";
import { FirestoreUserRepository } from "./access/firestoreUserRepository.ts";

// Placeholder until a real Workspace domain is configured for deployment.
const ALLOWED_WORKSPACE_DOMAIN = process.env.ALLOWED_WORKSPACE_DOMAIN ?? "example.com";

export function repository(): FirestoreUserRepository {
  return new FirestoreUserRepository(getFirestore());
}

export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) {
    return error;
  }
  if (
    error instanceof AccessDeniedError ||
    error instanceof NotAllowlistedError ||
    error instanceof ForbiddenError
  ) {
    return new HttpsError("permission-denied", error.message);
  }
  if (error instanceof LastAdministratorError) {
    return new HttpsError("failed-precondition", error.message);
  }
  if (error instanceof UserNotFoundError || error instanceof JobRecordNotFoundError) {
    return new HttpsError("not-found", error.message);
  }
  if (error instanceof InvalidArgumentError) {
    return new HttpsError("invalid-argument", error.message);
  }
  if (error instanceof DiscrepancyActiveError || error instanceof NotDuplicateError) {
    return new HttpsError("failed-precondition", error.message);
  }
  return new HttpsError("internal", "Unexpected error");
}

export async function requireCaller(auth: CallableRequest["auth"]): Promise<ResolvedAccess> {
  const email = auth?.token.email;
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign-in required");
  }
  return resolveAccess(repository(), { allowedWorkspaceDomain: ALLOWED_WORKSPACE_DOMAIN }, email);
}

/**
 * Defines an onCall Cloud Function that authenticates the caller, optionally
 * parses/validates the request payload, and translates any thrown domain
 * error to the right HttpsError code — the shape every callable in this
 * codebase needs, owned once instead of repeated at every call site.
 */
export function defineCallable<TInput = void, TResult = unknown>(config: {
  parse?: (data: unknown) => TInput;
  handle: (caller: ResolvedAccess, input: TInput) => Promise<TResult>;
}) {
  return onCall(async (request) => {
    try {
      const caller = await requireCaller(request.auth);
      const input = config.parse ? config.parse(request.data) : (undefined as TInput);
      return await config.handle(caller, input);
    } catch (error) {
      throw toHttpsError(error);
    }
  });
}
