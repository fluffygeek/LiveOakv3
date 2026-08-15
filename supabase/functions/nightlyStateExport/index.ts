import { PostgresJobRecordRepository } from "../_shared/postgresJobRecordRepository.ts";
import { PostgresStateExportRepository } from "../_shared/postgresStateExportRepository.ts";
import { serviceRoleClient } from "../_shared/postgresUserRepository.ts";
import { createHandler } from "./handler.ts";

// Production entrypoint — deployed as-is, never imported by tests (see handler.ts for the
// testable logic).
Deno.serve(
  createHandler(
    new PostgresJobRecordRepository(serviceRoleClient()),
    new PostgresStateExportRepository(serviceRoleClient()),
  ),
);
