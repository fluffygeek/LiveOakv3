import { easternWeekWindow, type JobRecord, type Role } from "@liveoakv3/shared";
import { ForbiddenError, InvalidArgumentError } from "../access/errors.js";
import type { JobRecordRepository } from "./jobRecordRepository.js";

export interface WeeklyListDeps {
  jobRecordRepo: JobRecordRepository;
  now?: () => string;
}

export interface WeeklyList {
  startIso: string;
  endIso: string;
  records: JobRecord[];
}

const defaultNow = () => new Date().toISOString();

function requireTechnician(callerRoles: Role[]): void {
  if (!callerRoles.includes("technician")) {
    throw new ForbiddenError("Only a Technician can view their weekly Job Record list");
  }
}

function requireNonPositiveWholeNumber(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value > 0) {
    throw new InvalidArgumentError(`${field} must be a whole number, zero or negative`);
  }
  return value;
}

/**
 * The requesting Technician's own Job Records for the live Sun-Sat Eastern
 * week containing "now", or an earlier week via a negative weekOffset.
 */
export async function listMyWeeklyJobRecords(
  callerEmail: string,
  callerRoles: Role[],
  weekOffset: number,
  deps: WeeklyListDeps,
): Promise<WeeklyList> {
  requireTechnician(callerRoles);
  requireNonPositiveWholeNumber(weekOffset, "weekOffset");

  const now = deps.now ?? defaultNow;
  const { startIso, endIso } = easternWeekWindow(now(), weekOffset);
  const records = await deps.jobRecordRepo.listByTechnicianAndWindow(
    callerEmail,
    startIso,
    endIso,
  );

  return {
    startIso,
    endIso,
    records: [...records].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
  };
}
