/**
 * "verified" — matched USPS records via the vendor.
 * "unverified" — vendor check failed/no-match; flagged for admin follow-up, not blocking.
 * "newBuild" — Technician self-declared new build; verification skipped entirely.
 */
export type AddressVerificationStatus = "verified" | "unverified" | "newBuild";

export interface DuplicateLink {
  isDuplicate: boolean;
  /** recordIds of every other Job Record linked as a Duplicate of this one. */
  linkedRecordIds: string[];
  /** True for the first-submitted (payable) record in a Duplicate group. */
  isPrimary: boolean;
}

export interface JobRecord {
  /** System-generated internal identifier — the actual primary key. */
  recordId: string;
  /** Technician-entered, non-unique reference to the external dispatch/work-order system. */
  jobId: string;
  technicianEmail: string;
  address: string;
  /** Vendor-normalized address, set only when addressVerificationStatus is "verified". */
  verifiedAddress: string | null;
  addressVerificationStatus: AddressVerificationStatus;
  workCode: string;
  /** Whole number, linear feet. */
  footage: number;
  photoUrls: string[];
  notes: string;
  /** Device-local time at the moment the Technician tapped Submit. */
  submittedAt: string;
  /** Server-received time — may lag submittedAt when the record was drafted offline. */
  createdAt: string;
  /** True when submittedAt and createdAt differ enough to be implausible (e.g. a wrong device clock). Flags for review; never blocks. */
  timestampSuspect: boolean;
  duplicate: DuplicateLink;
}

export function noDuplicateLink(): DuplicateLink {
  return { isDuplicate: false, linkedRecordIds: [], isPrimary: false };
}
