import { PostgresUserRepository, serviceRoleClient } from "../_shared/postgresUserRepository.ts";
import { createHandler } from "./handler.ts";

// Production entrypoint — deployed as-is, never imported by tests (see handler.ts for the
// testable logic). Constructing the repository here, inside Deno.serve's request-scoped
// startup rather than eagerly at import time in a shared module, matches
// callableHandler.ts's verifyCaller lazy-client pattern: the service_role client is only
// created once this module actually runs as a deployed/served function, where
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are guaranteed to be present.
Deno.serve(createHandler(new PostgresUserRepository(serviceRoleClient())));
