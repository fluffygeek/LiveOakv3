import { InvalidArgumentError } from "../access/errors.js";
import type { EditableJobRecordPatch } from "./jobRecordReviewService.js";
import type { CreateJobRecordInput } from "./jobRecordService.js";

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new InvalidArgumentError(`${field} must be a string`);
  }
  return value;
}

function parseWholeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new InvalidArgumentError(`${field} must be a whole number`);
  }
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new InvalidArgumentError(`${field} must be an array of strings`);
  }
  return value;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidArgumentError(`${field} must be a boolean`);
  }
  return value;
}

/** Validates untyped callable-function input at the boundary before it reaches jobRecordService. */
export function parseCreateJobRecordInput(data: unknown): CreateJobRecordInput {
  if (typeof data !== "object" || data === null) {
    throw new InvalidArgumentError("request body must be an object");
  }
  const record = data as Record<string, unknown>;
  return {
    jobId: parseString(record.jobId, "jobId"),
    address: parseString(record.address, "address"),
    workCode: parseString(record.workCode, "workCode"),
    footage: parseWholeNumber(record.footage, "footage"),
    photoUrls: parseStringArray(record.photoUrls, "photoUrls"),
    notes: typeof record.notes === "string" ? record.notes : "",
    isNewBuild: parseBoolean(record.isNewBuild, "isNewBuild"),
    submittedAt: parseString(record.submittedAt, "submittedAt"),
  };
}

function asRecord(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null) {
    throw new InvalidArgumentError("request body must be an object");
  }
  return data as Record<string, unknown>;
}

export function parseRecordId(data: unknown): string {
  const record = asRecord(data);
  return parseString(record.recordId, "recordId");
}

/** Only the fields present in `data` are parsed — the rest of the patch is left undefined. */
export function parseEditJobRecordPatch(data: unknown): {
  recordId: string;
  patch: EditableJobRecordPatch;
} {
  const record = asRecord(data);
  const patch: EditableJobRecordPatch = {};
  if (record.jobId !== undefined) patch.jobId = parseString(record.jobId, "jobId");
  if (record.address !== undefined) patch.address = parseString(record.address, "address");
  if (record.workCode !== undefined) patch.workCode = parseString(record.workCode, "workCode");
  if (record.footage !== undefined) patch.footage = parseWholeNumber(record.footage, "footage");
  if (record.photoUrls !== undefined) {
    patch.photoUrls = parseStringArray(record.photoUrls, "photoUrls");
  }
  if (record.notes !== undefined) patch.notes = parseString(record.notes, "notes");
  return { recordId: parseString(record.recordId, "recordId"), patch };
}

export function parseSetDiscrepancyInput(data: unknown): {
  recordId: string;
  active: boolean;
  reason: string | null;
} {
  const record = asRecord(data);
  const reason =
    record.reason === null || record.reason === undefined
      ? null
      : parseString(record.reason, "reason");
  return {
    recordId: parseString(record.recordId, "recordId"),
    active: parseBoolean(record.active, "active"),
    reason,
  };
}

export function parseSetFlagInput(data: unknown): { recordId: string; value: boolean } {
  const record = asRecord(data);
  return {
    recordId: parseString(record.recordId, "recordId"),
    value: parseBoolean(record.value, "value"),
  };
}

/** weekOffset defaults to 0 (the current week) when absent. */
export function parseWeeklyListInput(data: unknown): { weekOffset: number } {
  const record = asRecord(data);
  if (record.weekOffset === undefined) {
    return { weekOffset: 0 };
  }
  return { weekOffset: parseWholeNumber(record.weekOffset, "weekOffset") };
}

export function parseUnlinkDuplicateInput(data: unknown): {
  recordId: string;
  otherRecordId: string;
} {
  const record = asRecord(data);
  return {
    recordId: parseString(record.recordId, "recordId"),
    otherRecordId: parseString(record.otherRecordId, "otherRecordId"),
  };
}
