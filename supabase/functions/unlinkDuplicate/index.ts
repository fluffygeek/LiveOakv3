import { PostgresUserRepository, serviceRoleClient } from "../_shared/postgresUserRepository.ts";
import { PostgresJobRecordRepository } from "../_shared/postgresJobRecordRepository.ts";
import { PostgresAuditLogRepository } from "../_shared/postgresAuditLogRepository.ts";
import { createHandler } from "./handler.ts";

// Production entrypoint — deployed as-is, never imported by tests (see handler.ts for the
// testable logic).
Deno.serve(
  createHandler(
    new PostgresUserRepository(serviceRoleClient()),
    new PostgresJobRecordRepository(serviceRoleClient()),
    new PostgresAuditLogRepository(serviceRoleClient()),
  ),
);
