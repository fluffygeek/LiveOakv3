import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FirestoreJobRecordRepository } from "./jobRecords/firestoreJobRecordRepository.js";
import { sendDiscrepancyEmail } from "./notifications/discrepancyEmailService.js";
import { NotConfiguredEmailSender } from "./notifications/notConfiguredEmailSender.js";
import { generateStateExport } from "./notifications/stateExportService.js";
import { FirestoreStateExportRepository } from "./notifications/firestoreStateExportRepository.js";
import { repository } from "./callableHandler.js";

initializeApp();

export * from "./access/handlers.js";
export * from "./jobRecords/handlers.js";

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
