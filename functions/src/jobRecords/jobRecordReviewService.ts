import {
  findDiscrepancyReason,
  findWorkCode,
  type AuditLogEntry,
  type JobRecord,
  type Role,
} from "@liveoakv3/shared";
import {
  DiscrepancyActiveError,
  ForbiddenError,
  InvalidArgumentError,
  JobRecordNotFoundError,
  NotDuplicateError,
} from "../access/errors.js";
import type { AuditLogRepository } from "./auditLogRepository.js";
import type { JobRecordRepository } from "./jobRecordRepository.js";

export interface EditableJobRecordPatch {
  jobId?: string;
  address?: string;
  workCode?: string;
  footage?: number;
  photoUrls?: string[];
  notes?: string;
}

export interface JobRecordReviewDeps {
  jobRecordRepo: JobRecordRepository;
  auditLogRepo: AuditLogRepository;
  now?: () => string;
  generateId?: () => string;
}

const defaultNow = () => new Date().toISOString();
const defaultGenerateId = () => crypto.randomUUID();

function requirePayrollOrApplicationAdministrator(callerRoles: Role[]): void {
  if (
    !callerRoles.includes("payrollAdministrator") &&
    !callerRoles.includes("applicationAdministrator")
  ) {
    throw new ForbiddenError(
      "Only a Payroll Administrator or Application Administrator can perform this action",
    );
  }
}

/** Once Closed, only an Application Administrator may keep editing the record. */
function requireEditableByPayroll(record: JobRecord, callerRoles: Role[]): void {
  if (record.closed && !callerRoles.includes("applicationAdministrator")) {
    throw new ForbiddenError(
      "Only an Application Administrator can edit a Closed Job Record",
    );
  }
}

async function requireRecord(
  jobRecordRepo: JobRecordRepository,
  recordId: string,
): Promise<JobRecord> {
  const record = await jobRecordRepo.getById(recordId);
  if (!record) {
    throw new JobRecordNotFoundError(`No Job Record found for "${recordId}"`);
  }
  return record;
}

function requireNonEmptyString(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidArgumentError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireWholeNumber(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new InvalidArgumentError(`${field} must be a non-negative whole number`);
  }
  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

async function writeAuditEntry(
  deps: JobRecordReviewDeps,
  recordId: string,
  actorEmail: string,
  action: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  const generateId = deps.generateId ?? defaultGenerateId;
  const now = deps.now ?? defaultNow;
  const entry: AuditLogEntry = {
    id: generateId(),
    recordId,
    actorEmail,
    action,
    timestamp: now(),
    before,
    after,
  };
  await deps.auditLogRepo.append(entry);
}

export async function listJobRecords(
  callerRoles: Role[],
  deps: Pick<JobRecordReviewDeps, "jobRecordRepo">,
): Promise<JobRecord[]> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  return deps.jobRecordRepo.list();
}

export async function getJobRecord(
  callerRoles: Role[],
  recordId: string,
  deps: Pick<JobRecordReviewDeps, "jobRecordRepo">,
): Promise<JobRecord> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  return requireRecord(deps.jobRecordRepo, recordId);
}

export async function listJobRecordAuditLog(
  callerRoles: Role[],
  recordId: string,
  deps: Pick<JobRecordReviewDeps, "auditLogRepo">,
): Promise<AuditLogEntry[]> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  return deps.auditLogRepo.listByRecordId(recordId);
}

/** Validates the merged record's workCode/photoUrls stay consistent, whichever field was actually edited. */
function requireValidPhotoMinimum(record: JobRecord): void {
  const workCode = findWorkCode(record.workCode);
  if (!workCode) {
    throw new InvalidArgumentError(`"${record.workCode}" is not a known work code`);
  }
  if (record.photoUrls.length < workCode.minPhotos) {
    throw new InvalidArgumentError(
      `${workCode.code} requires at least ${workCode.minPhotos} photos, got ${record.photoUrls.length}`,
    );
  }
}

export async function editJobRecord(
  callerEmail: string,
  callerRoles: Role[],
  recordId: string,
  patch: EditableJobRecordPatch,
  deps: JobRecordReviewDeps,
): Promise<JobRecord> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  const record = await requireRecord(deps.jobRecordRepo, recordId);
  requireEditableByPayroll(record, callerRoles);

  if (patch.jobId !== undefined) requireNonEmptyString(patch.jobId, "jobId");
  if (patch.address !== undefined) requireNonEmptyString(patch.address, "address");
  if (patch.footage !== undefined) requireWholeNumber(patch.footage, "footage");
  if (patch.workCode !== undefined && !findWorkCode(patch.workCode)) {
    throw new InvalidArgumentError(`"${patch.workCode}" is not a known work code`);
  }

  const changedKeys = (Object.keys(patch) as (keyof EditableJobRecordPatch)[]).filter(
    (key) => patch[key] !== undefined && !valuesEqual(patch[key], record[key]),
  );

  if (changedKeys.length === 0) {
    return record;
  }

  const merged: JobRecord = { ...record };
  for (const key of changedKeys) {
    switch (key) {
      case "jobId":
        merged.jobId = patch.jobId!;
        break;
      case "address":
        merged.address = patch.address!;
        break;
      case "workCode":
        merged.workCode = patch.workCode!;
        break;
      case "footage":
        merged.footage = patch.footage!;
        break;
      case "photoUrls":
        merged.photoUrls = patch.photoUrls!;
        break;
      case "notes":
        merged.notes = patch.notes!;
        break;
    }
  }
  // Only re-check the photo minimum when this edit could actually violate it —
  // an edit to an unrelated field (e.g. notes) shouldn't be blocked by a
  // pre-existing photoUrls/workCode combination it didn't touch.
  if (changedKeys.includes("workCode") || changedKeys.includes("photoUrls")) {
    requireValidPhotoMinimum(merged);
  }

  await deps.jobRecordRepo.update(merged);

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of changedKeys) {
    before[key] = record[key];
    after[key] = merged[key];
  }
  await writeAuditEntry(deps, recordId, callerEmail, "edited", before, after);

  return merged;
}

export async function setDiscrepancy(
  callerEmail: string,
  callerRoles: Role[],
  recordId: string,
  active: boolean,
  reason: string | null,
  deps: JobRecordReviewDeps,
): Promise<JobRecord> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  const record = await requireRecord(deps.jobRecordRepo, recordId);
  requireEditableByPayroll(record, callerRoles);

  let nextReason: string | null = null;
  if (active) {
    if (!reason || !findDiscrepancyReason(reason)) {
      throw new InvalidArgumentError(`"${String(reason)}" is not a known discrepancy reason`);
    }
    nextReason = reason;
  }

  if (record.discrepancy === active && record.discrepancyReason === nextReason) {
    return record;
  }

  const merged: JobRecord = { ...record, discrepancy: active, discrepancyReason: nextReason };
  await deps.jobRecordRepo.update(merged);
  await writeAuditEntry(
    deps,
    recordId,
    callerEmail,
    "discrepancy-set",
    { discrepancy: record.discrepancy, discrepancyReason: record.discrepancyReason },
    { discrepancy: merged.discrepancy, discrepancyReason: merged.discrepancyReason },
  );

  return merged;
}

export async function setPicturesDownloaded(
  callerEmail: string,
  callerRoles: Role[],
  recordId: string,
  value: boolean,
  deps: JobRecordReviewDeps,
): Promise<JobRecord> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  const record = await requireRecord(deps.jobRecordRepo, recordId);
  // Not gated by requireEditableByPayroll — Pictures Downloaded tracks retrieval
  // independent of Discrepancy or Closed status (CONTEXT.md).

  if (record.picturesDownloaded === value) {
    return record;
  }

  const merged: JobRecord = { ...record, picturesDownloaded: value };
  await deps.jobRecordRepo.update(merged);
  await writeAuditEntry(
    deps,
    recordId,
    callerEmail,
    "pictures-downloaded-set",
    { picturesDownloaded: record.picturesDownloaded },
    { picturesDownloaded: merged.picturesDownloaded },
  );

  return merged;
}

export async function setClosed(
  callerEmail: string,
  callerRoles: Role[],
  recordId: string,
  value: boolean,
  deps: JobRecordReviewDeps,
): Promise<JobRecord> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  const record = await requireRecord(deps.jobRecordRepo, recordId);
  requireEditableByPayroll(record, callerRoles);

  if (value && record.discrepancy) {
    throw new DiscrepancyActiveError(
      "Cannot mark a Job Record Closed while it has an active Discrepancy",
    );
  }

  if (record.closed === value) {
    return record;
  }

  const merged: JobRecord = { ...record, closed: value };
  await deps.jobRecordRepo.update(merged);
  await writeAuditEntry(
    deps,
    recordId,
    callerEmail,
    "closed-set",
    { closed: record.closed },
    { closed: merged.closed },
  );

  return merged;
}

export async function overrideDuplicatePrimary(
  callerEmail: string,
  callerRoles: Role[],
  recordId: string,
  deps: JobRecordReviewDeps,
): Promise<JobRecord[]> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  const record = await requireRecord(deps.jobRecordRepo, recordId);
  requireEditableByPayroll(record, callerRoles);

  if (!record.duplicate.isDuplicate) {
    throw new NotDuplicateError(`"${recordId}" is not part of a Duplicate group`);
  }

  if (record.duplicate.isPrimary) {
    return [record];
  }

  const siblings = await Promise.all(
    record.duplicate.linkedRecordIds.map((id) => requireRecord(deps.jobRecordRepo, id)),
  );
  const previousPrimary = siblings.find((sibling) => sibling.duplicate.isPrimary);
  if (previousPrimary) {
    requireEditableByPayroll(previousPrimary, callerRoles);
  }

  const updatedRecord: JobRecord = {
    ...record,
    duplicate: { ...record.duplicate, isPrimary: true },
  };

  const updated = [updatedRecord];
  let updatedPreviousPrimary: JobRecord | null = null;
  if (previousPrimary) {
    updatedPreviousPrimary = {
      ...previousPrimary,
      duplicate: { ...previousPrimary.duplicate, isPrimary: false },
    };
    updated.push(updatedPreviousPrimary);
  }

  // Both sides of the primary flip are written as one atomic batch — a
  // partial write would otherwise leave two records simultaneously (or
  // neither) marked primary within the same Duplicate group.
  await deps.jobRecordRepo.updateMany(updated);

  await writeAuditEntry(
    deps,
    recordId,
    callerEmail,
    "duplicate-primary-overridden",
    { isPrimary: false },
    { isPrimary: true },
  );
  if (updatedPreviousPrimary) {
    await writeAuditEntry(
      deps,
      updatedPreviousPrimary.recordId,
      callerEmail,
      "duplicate-primary-overridden",
      { isPrimary: true },
      { isPrimary: false },
    );
  }

  const unchangedSiblings = siblings.filter(
    (sibling) => sibling.recordId !== previousPrimary?.recordId,
  );
  return [...updated, ...unchangedSiblings];
}

export async function unlinkDuplicate(
  callerEmail: string,
  callerRoles: Role[],
  recordId: string,
  otherRecordId: string,
  deps: JobRecordReviewDeps,
): Promise<{ record: JobRecord; other: JobRecord }> {
  requirePayrollOrApplicationAdministrator(callerRoles);
  const record = await requireRecord(deps.jobRecordRepo, recordId);
  const other = await requireRecord(deps.jobRecordRepo, otherRecordId);

  if (
    !record.duplicate.linkedRecordIds.includes(otherRecordId) ||
    !other.duplicate.linkedRecordIds.includes(recordId)
  ) {
    throw new NotDuplicateError(`"${recordId}" and "${otherRecordId}" are not linked`);
  }

  requireEditableByPayroll(record, callerRoles);
  requireEditableByPayroll(other, callerRoles);

  function unlinked(target: JobRecord, removeId: string): JobRecord {
    const remainingIds = target.duplicate.linkedRecordIds.filter((id) => id !== removeId);
    return {
      ...target,
      duplicate:
        remainingIds.length === 0
          ? { isDuplicate: false, linkedRecordIds: [], isPrimary: false }
          : { ...target.duplicate, linkedRecordIds: remainingIds },
    };
  }

  const updatedRecord = unlinked(record, otherRecordId);
  const updatedOther = unlinked(other, recordId);

  // Written atomically — a partial write would otherwise leave one side of
  // the link removed while the other still references it.
  await deps.jobRecordRepo.updateMany([updatedRecord, updatedOther]);

  await writeAuditEntry(
    deps,
    recordId,
    callerEmail,
    "duplicate-unlinked",
    { duplicate: record.duplicate },
    { duplicate: updatedRecord.duplicate },
  );
  await writeAuditEntry(
    deps,
    otherRecordId,
    callerEmail,
    "duplicate-unlinked",
    { duplicate: other.duplicate },
    { duplicate: updatedOther.duplicate },
  );

  return { record: updatedRecord, other: updatedOther };
}
