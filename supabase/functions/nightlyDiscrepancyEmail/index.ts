import { NotConfiguredEmailSender } from "../../../functions/src/notifications/notConfiguredEmailSender.ts";
import { PostgresJobRecordRepository } from "../_shared/postgresJobRecordRepository.ts";
import { PostgresUserRepository, serviceRoleClient } from "../_shared/postgresUserRepository.ts";
import { createHandler } from "./handler.ts";

// Production entrypoint — deployed as-is, never imported by tests (see handler.ts for the
// testable logic). No email vendor has been chosen yet (see
// functions/src/notifications/notConfiguredEmailSender.ts's doc comment) — this wiring
// mirrors the Firebase-era job's discrepancyEmailDeps() in functions/src/index.ts, which
// also uses NotConfiguredEmailSender pending a real vendor decision.
Deno.serve(
  createHandler(
    new PostgresJobRecordRepository(serviceRoleClient()),
    new PostgresUserRepository(serviceRoleClient()),
    new NotConfiguredEmailSender(),
  ),
);
