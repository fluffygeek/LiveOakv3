import { getFirestore } from "firebase-admin/firestore";
import { defineCallable } from "../callableHandler.js";
import { FirestoreAuditLogRepository } from "./firestoreAuditLogRepository.js";
import { FirestoreJobRecordRepository } from "./firestoreJobRecordRepository.js";
import { NotConfiguredAddressVerifier } from "./notConfiguredAddressVerifier.js";
import { createJobRecord as createJobRecordService } from "./jobRecordService.js";
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
} from "./jobRecordReviewService.js";
import { listMyWeeklyJobRecords as listMyWeeklyJobRecordsService } from "./weeklyListService.js";
import {
  parseCreateJobRecordInput,
  parseEditJobRecordPatch,
  parseRecordId,
  parseSetDiscrepancyInput,
  parseSetFlagInput,
  parseUnlinkDuplicateInput,
  parseWeeklyListInput,
} from "./validation.js";

function jobRecordDeps() {
  const db = getFirestore();
  return {
    jobRecordRepo: new FirestoreJobRecordRepository(db),
    auditLogRepo: new FirestoreAuditLogRepository(db),
    addressVerifier: new NotConfiguredAddressVerifier(),
  };
}

export const createJobRecord = defineCallable({
  parse: parseCreateJobRecordInput,
  handle: (caller, input) =>
    createJobRecordService(caller.email, caller.roles, input, jobRecordDeps()),
});

export const listJobRecords = defineCallable({
  handle: (caller) => listJobRecordsService(caller.roles, jobRecordDeps()),
});

export const getJobRecord = defineCallable({
  parse: parseRecordId,
  handle: (caller, recordId) => getJobRecordService(caller.roles, recordId, jobRecordDeps()),
});

export const listJobRecordAuditLog = defineCallable({
  parse: parseRecordId,
  handle: (caller, recordId) =>
    listJobRecordAuditLogService(caller.roles, recordId, jobRecordDeps()),
});

export const editJobRecord = defineCallable({
  parse: parseEditJobRecordPatch,
  handle: (caller, { recordId, patch }) =>
    editJobRecordService(caller.email, caller.roles, recordId, patch, jobRecordDeps()),
});

export const setDiscrepancy = defineCallable({
  parse: parseSetDiscrepancyInput,
  handle: (caller, { recordId, active, reason }) =>
    setDiscrepancyService(caller.email, caller.roles, recordId, active, reason, jobRecordDeps()),
});

export const setPicturesDownloaded = defineCallable({
  parse: parseSetFlagInput,
  handle: (caller, { recordId, value }) =>
    setPicturesDownloadedService(caller.email, caller.roles, recordId, value, jobRecordDeps()),
});

export const setClosed = defineCallable({
  parse: parseSetFlagInput,
  handle: (caller, { recordId, value }) =>
    setClosedService(caller.email, caller.roles, recordId, value, jobRecordDeps()),
});

export const overrideDuplicatePrimary = defineCallable({
  parse: parseRecordId,
  handle: (caller, recordId) =>
    overrideDuplicatePrimaryService(caller.email, caller.roles, recordId, jobRecordDeps()),
});

export const unlinkDuplicate = defineCallable({
  parse: parseUnlinkDuplicateInput,
  handle: (caller, { recordId, otherRecordId }) =>
    unlinkDuplicateService(caller.email, caller.roles, recordId, otherRecordId, jobRecordDeps()),
});

export const listMyWeeklyJobRecords = defineCallable({
  parse: parseWeeklyListInput,
  handle: (caller, { weekOffset }) =>
    listMyWeeklyJobRecordsService(caller.email, caller.roles, weekOffset, jobRecordDeps()),
});
