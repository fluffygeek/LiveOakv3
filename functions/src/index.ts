import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  inviteUser as inviteUserService,
  listUsers as listUsersService,
  resolveAccess,
  revokeUser as revokeUserService,
  setDistributionListMembership as setDistributionListMembershipService,
  updateUserRoles as updateUserRolesService,
  type ResolvedAccess,
} from "./access/accessService.js";
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
} from "./access/errors.js";
import { FirestoreUserRepository } from "./access/firestoreUserRepository.js";
import { parseEmail, parseOnDistributionList, parseRoles } from "./access/validation.js";
import { NotConfiguredAddressVerifier } from "./jobRecords/notConfiguredAddressVerifier.js";
import { FirestoreAuditLogRepository } from "./jobRecords/firestoreAuditLogRepository.js";
import { FirestoreJobRecordRepository } from "./jobRecords/firestoreJobRecordRepository.js";
import { createJobRecord as createJobRecordService } from "./jobRecords/jobRecordService.js";
import {
  editJobRecord as editJobRecordService,
  getJobRecord as getJobRecordService,
  listJobRecordAuditLog as listJobRecordAuditLogService,
  listJobRecords as listJobRecordsService,
  overrideDuplicatePrimary as overrideDuplicatePrimaryService,
  setClosed as setClosedService,
  setDiscrepancy as setDiscrepancyService,
  setPicturesDownloaded as setPicturesDownloadedService,
  unlinkDuplicate as unlinkDuplicateService,
} from "./jobRecords/jobRecordReviewService.js";
import { listMyWeeklyJobRecords as listMyWeeklyJobRecordsService } from "./jobRecords/weeklyListService.js";
import {
  parseCreateJobRecordInput,
  parseEditJobRecordPatch,
  parseRecordId,
  parseSetDiscrepancyInput,
  parseSetFlagInput,
  parseUnlinkDuplicateInput,
  parseWeeklyListInput,
} from "./jobRecords/validation.js";
import { sendDiscrepancyEmail } from "./notifications/discrepancyEmailService.js";
import { NotConfiguredEmailSender } from "./notifications/notConfiguredEmailSender.js";
import { generateStateExport } from "./notifications/stateExportService.js";
import { FirestoreStateExportRepository } from "./notifications/firestoreStateExportRepository.js";

initializeApp();

// Placeholder until a real Workspace domain is configured for deployment.
const ALLOWED_WORKSPACE_DOMAIN =
  process.env.ALLOWED_WORKSPACE_DOMAIN ?? "example.com";

function repository(): FirestoreUserRepository {
  return new FirestoreUserRepository(getFirestore());
}

function jobRecordDeps() {
  const db = getFirestore();
  return {
    jobRecordRepo: new FirestoreJobRecordRepository(db),
    auditLogRepo: new FirestoreAuditLogRepository(db),
    addressVerifier: new NotConfiguredAddressVerifier(),
  };
}

function discrepancyEmailDeps() {
  const db = getFirestore();
  return {
    jobRecordRepo: new FirestoreJobRecordRepository(db),
    userRepo: repository(),
    emailSender: new NotConfiguredEmailSender(),
  };
}

function stateExportDeps() {
  const db = getFirestore();
  return {
    jobRecordRepo: new FirestoreJobRecordRepository(db),
    stateExportRepo: new FirestoreStateExportRepository(db),
  };
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
  if (error instanceof JobRecordNotFoundError) {
    return new HttpsError("not-found", error.message);
  }
  if (error instanceof DiscrepancyActiveError || error instanceof NotDuplicateError) {
    return new HttpsError("failed-precondition", error.message);
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

export const createJobRecord = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const input = parseCreateJobRecordInput(request.data);
    return await createJobRecordService(caller.email, caller.roles, input, jobRecordDeps());
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const listJobRecords = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    return await listJobRecordsService(caller.roles, jobRecordDeps());
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const getJobRecord = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const recordId = parseRecordId(request.data);
    return await getJobRecordService(caller.roles, recordId, jobRecordDeps());
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const listJobRecordAuditLog = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const recordId = parseRecordId(request.data);
    return await listJobRecordAuditLogService(caller.roles, recordId, jobRecordDeps());
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const editJobRecord = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const { recordId, patch } = parseEditJobRecordPatch(request.data);
    return await editJobRecordService(
      caller.email,
      caller.roles,
      recordId,
      patch,
      jobRecordDeps(),
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const setDiscrepancy = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const { recordId, active, reason } = parseSetDiscrepancyInput(request.data);
    return await setDiscrepancyService(
      caller.email,
      caller.roles,
      recordId,
      active,
      reason,
      jobRecordDeps(),
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const setPicturesDownloaded = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const { recordId, value } = parseSetFlagInput(request.data);
    return await setPicturesDownloadedService(
      caller.email,
      caller.roles,
      recordId,
      value,
      jobRecordDeps(),
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const setClosed = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const { recordId, value } = parseSetFlagInput(request.data);
    return await setClosedService(
      caller.email,
      caller.roles,
      recordId,
      value,
      jobRecordDeps(),
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const overrideDuplicatePrimary = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const recordId = parseRecordId(request.data);
    return await overrideDuplicatePrimaryService(
      caller.email,
      caller.roles,
      recordId,
      jobRecordDeps(),
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const unlinkDuplicate = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const { recordId, otherRecordId } = parseUnlinkDuplicateInput(request.data);
    return await unlinkDuplicateService(
      caller.email,
      caller.roles,
      recordId,
      otherRecordId,
      jobRecordDeps(),
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const listMyWeeklyJobRecords = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const { weekOffset } = parseWeeklyListInput(request.data);
    return await listMyWeeklyJobRecordsService(
      caller.email,
      caller.roles,
      weekOffset,
      jobRecordDeps(),
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const setDistributionListMembership = onCall(async (request) => {
  try {
    const caller = await requireCaller(request.auth);
    const data = request.data as Record<string, unknown>;
    const email = parseEmail(data.email);
    const onDistributionList = parseOnDistributionList(data.onDistributionList);
    return await setDistributionListMembershipService(
      repository(),
      caller.roles,
      email,
      onDistributionList,
    );
  } catch (error) {
    throw toHttpsError(error);
  }
});

// 8pm Central — before the state export, so the export reflects a settled
// day rather than racing it. Cloud Scheduler resolves this fixed local time
// against America/Chicago's DST rules itself; nothing in this codebase
// computes that offset the way easternWeekWindow does for #5.
export const nightlyDiscrepancyEmail = onSchedule(
  { schedule: "0 20 * * *", timeZone: "America/Chicago" },
  async () => {
    await sendDiscrepancyEmail(discrepancyEmailDeps());
  },
);

export const nightlyStateExport = onSchedule(
  { schedule: "0 21 * * *", timeZone: "America/Chicago" },
  async () => {
    await generateStateExport(stateExportDeps());
  },
);
