import { isDistributionListEligibleRole, type JobRecord, type UserRecord } from "@liveoakv3/shared";
import type { UserRepository } from "../access/userRepository.ts";
import type { JobRecordRepository } from "../jobRecords/jobRecordRepository.ts";
import type { EmailSender } from "./emailSender.ts";

export interface DiscrepancyEmailDeps {
  jobRecordRepo: JobRecordRepository;
  userRepo: UserRepository;
  emailSender: EmailSender;
}

export interface DiscrepancyEmailResult {
  sent: boolean;
  recipientCount: number;
  discrepancyCount: number;
}

// Belt-and-suspenders: setDistributionListMembership (accessService.ts)
// already enforces this at add-time, but a user's roles can change after
// being added, so the send path re-checks rather than trusting stale state.
function isDistributionListEligible(user: UserRecord): boolean {
  return user.active && user.onDistributionList && isDistributionListEligibleRole(user.roles);
}

export async function getDistributionListRecipients(
  userRepo: UserRepository,
): Promise<string[]> {
  const users = await userRepo.listUsers();
  return users.filter(isDistributionListEligible).map((user) => user.email);
}

function formatDiscrepancyLine(record: JobRecord): string {
  return [
    record.recordId,
    record.jobId,
    record.address,
    `reason: ${record.discrepancyReason}`,
    `technician: ${record.technicianEmail}`,
    `submitted: ${record.submittedAt}`,
  ].join(" | ");
}

export function formatDiscrepancyEmail(records: JobRecord[]): {
  subject: string;
  body: string;
} {
  if (records.length === 0) {
    return {
      subject: "Nightly Discrepancy report: no active Discrepancies",
      body: "No active Discrepancies.",
    };
  }
  return {
    subject: `Nightly Discrepancy report: ${records.length} active`,
    body: records.map(formatDiscrepancyLine).join("\n"),
  };
}

/**
 * Queries the live Discrepancy flag fresh on every call — there's no
 * "already notified" state to track, so an unresolved Discrepancy simply
 * reappears in tomorrow's email for as long as it stays active.
 */
export async function sendDiscrepancyEmail(
  deps: DiscrepancyEmailDeps,
): Promise<DiscrepancyEmailResult> {
  const [records, recipients] = await Promise.all([
    deps.jobRecordRepo.listWithActiveDiscrepancy(),
    getDistributionListRecipients(deps.userRepo),
  ]);

  if (recipients.length === 0) {
    return { sent: false, recipientCount: 0, discrepancyCount: records.length };
  }

  const { subject, body } = formatDiscrepancyEmail(records);
  await deps.emailSender.send({ to: recipients, subject, body });

  return { sent: true, recipientCount: recipients.length, discrepancyCount: records.length };
}
