import {
  findWorkCode,
  noDuplicateLink,
  normalizeAddress,
  type AddressVerificationStatus,
  type DuplicateLink,
  type JobRecord,
  type Role,
} from "@liveoakv3/shared";
import { ForbiddenError, InvalidArgumentError } from "../access/errors.ts";
import type { AddressVerifier } from "./addressVerifier.ts";
import type { AuditLogRepository } from "./auditLogRepository.ts";
import type { JobRecordRepository } from "./jobRecordRepository.ts";

export interface CreateJobRecordInput {
  jobId: string;
  address: string;
  workCode: string;
  footage: number;
  photoUrls: string[];
  notes: string;
  isNewBuild: boolean;
  /** Device-local time captured at the moment the Technician tapped Submit. */
  submittedAt: string;
}

export interface CreateJobRecordDeps {
  jobRecordRepo: JobRecordRepository;
  auditLogRepo: AuditLogRepository;
  addressVerifier: AddressVerifier;
  now?: () => string;
  generateId?: () => string;
}

const defaultNow = () => new Date().toISOString();
const defaultGenerateId = () => crypto.randomUUID();

// Anything further apart than this between the Technician's tap-Submit time
// and the server's receive time is flagged for review, not blocked — a
// legitimately offline Technician can take a few days to regain signal.
const SUSPECT_TIMESTAMP_GAP_MS = 7 * 24 * 60 * 60 * 1000;

function requireTechnician(callerRoles: Role[]): void {
  if (!callerRoles.includes("technician")) {
    throw new ForbiddenError("Only a Technician can submit a Job Record");
  }
}

function requireNonEmptyString(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidArgumentError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireIsoTimestamp(value: string, field: string): string {
  requireNonEmptyString(value, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidArgumentError(`${field} must be a valid timestamp`);
  }
  return value;
}

function requireWholeNumber(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new InvalidArgumentError(`${field} must be a non-negative whole number`);
  }
  return value;
}

function isTimestampSuspect(submittedAt: string, createdAt: string): boolean {
  const gap = Math.abs(Date.parse(createdAt) - Date.parse(submittedAt));
  return gap > SUSPECT_TIMESTAMP_GAP_MS;
}

interface AddressVerificationOutcome {
  status: AddressVerificationStatus;
  verifiedAddress: string | null;
}

/** Verification failure (no match, or the vendor call itself erroring) flags the record — it never blocks submission. */
async function resolveAddressVerification(
  isNewBuild: boolean,
  address: string,
  verifier: AddressVerifier,
): Promise<AddressVerificationOutcome> {
  if (isNewBuild) {
    return { status: "newBuild", verifiedAddress: null };
  }
  try {
    const result = await verifier.verify(address);
    if (result.matched) {
      return { status: "verified", verifiedAddress: result.normalizedAddress };
    }
    return { status: "unverified", verifiedAddress: null };
  } catch {
    return { status: "unverified", verifiedAddress: null };
  }
}

function sixMonthsBefore(iso: string): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() - 6);
  return date.toISOString();
}

/**
 * Matches within the window get linked as Duplicates, first-submitted as
 * primary. A pre-existing primary among the matches is preserved rather
 * than recomputed, so an admin's manual override (spec #4) survives a new
 * record joining the group later.
 */
function computeDuplicateLinks(
  newRecordId: string,
  matches: JobRecord[],
): { newRecordDuplicate: DuplicateLink; updatedMatches: JobRecord[] } {
  if (matches.length === 0) {
    return { newRecordDuplicate: noDuplicateLink(), updatedMatches: [] };
  }

  const existingPrimary = matches.find((match) => match.duplicate.isPrimary);
  const primaryId =
    existingPrimary?.recordId ??
    matches.reduce((earliest, match) =>
      match.submittedAt < earliest.submittedAt ? match : earliest,
    ).recordId;

  const allIds = [newRecordId, ...matches.map((match) => match.recordId)];

  const updatedMatches = matches.map((match) => ({
    ...match,
    duplicate: {
      isDuplicate: true,
      linkedRecordIds: allIds.filter((id) => id !== match.recordId),
      isPrimary: match.recordId === primaryId,
    },
  }));

  return {
    newRecordDuplicate: {
      isDuplicate: true,
      linkedRecordIds: matches.map((match) => match.recordId),
      isPrimary: newRecordId === primaryId,
    },
    updatedMatches,
  };
}

export async function createJobRecord(
  callerEmail: string,
  callerRoles: Role[],
  input: CreateJobRecordInput,
  deps: CreateJobRecordDeps,
): Promise<JobRecord> {
  requireTechnician(callerRoles);

  const jobId = requireNonEmptyString(input.jobId, "jobId");
  const address = requireNonEmptyString(input.address, "address");
  requireIsoTimestamp(input.submittedAt, "submittedAt");
  const footage = requireWholeNumber(input.footage, "footage");

  const workCode = findWorkCode(input.workCode);
  if (!workCode) {
    throw new InvalidArgumentError(`"${input.workCode}" is not a known work code`);
  }
  if (input.photoUrls.length < workCode.minPhotos) {
    throw new InvalidArgumentError(
      `${workCode.code} requires at least ${workCode.minPhotos} photos, got ${input.photoUrls.length}`,
    );
  }

  const now = deps.now ?? defaultNow;
  const generateId = deps.generateId ?? defaultGenerateId;
  const createdAt = now();
  const verification = await resolveAddressVerification(
    input.isNewBuild,
    address,
    deps.addressVerifier,
  );

  const recordId = generateId();
  const normalizedAddressKey = normalizeAddress(verification.verifiedAddress ?? address);

  // Reading the matches and writing the new record + any updated matches
  // happens as one atomic unit-of-work — otherwise two concurrent
  // createJobRecord calls for the same address could each see zero matches
  // and both miss the duplicate link.
  const record = await deps.jobRecordRepo.createWithDuplicateLinking(
    normalizedAddressKey,
    sixMonthsBefore(input.submittedAt),
    (matches) => {
      const { newRecordDuplicate, updatedMatches } = computeDuplicateLinks(recordId, matches);
      const newRecord: JobRecord = {
        recordId,
        jobId,
        technicianEmail: callerEmail,
        address,
        verifiedAddress: verification.verifiedAddress,
        addressVerificationStatus: verification.status,
        workCode: input.workCode,
        footage,
        photoUrls: input.photoUrls,
        notes: input.notes,
        submittedAt: input.submittedAt,
        createdAt,
        timestampSuspect: isTimestampSuspect(input.submittedAt, createdAt),
        duplicate: newRecordDuplicate,
        discrepancy: false,
        discrepancyReason: null,
        closed: false,
        picturesDownloaded: false,
      };
      return { record: newRecord, updatedMatches };
    },
  );

  await deps.auditLogRepo.append({
    id: generateId(),
    recordId: record.recordId,
    actorEmail: callerEmail,
    action: "created",
    timestamp: createdAt,
    before: null,
    after: record as unknown as Record<string, unknown>,
  });

  return record;
}
