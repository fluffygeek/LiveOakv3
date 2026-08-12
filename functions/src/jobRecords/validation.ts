import { InvalidArgumentError } from "../access/errors.js";
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
