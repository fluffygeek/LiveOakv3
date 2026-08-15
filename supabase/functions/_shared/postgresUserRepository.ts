import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import type { Role } from "../../../packages/shared/src/roles.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";

const TABLE = "users";

/** Shape of a row in the `users` table (supabase/migrations/*_users_table.sql) — snake_case
 * columns, `roles` as a native Postgres array of the `app_role` enum. */
interface UserRow {
  email: string;
  roles: Role[];
  active: boolean;
  invited_at: string;
  updated_at: string;
  on_distribution_list: boolean;
}

function fromRow(row: UserRow): UserRecord {
  return {
    email: row.email,
    roles: row.roles,
    active: row.active,
    invitedAt: row.invited_at,
    updatedAt: row.updated_at,
    onDistributionList: row.on_distribution_list,
  };
}

function toRow(record: UserRecord): UserRow {
  return {
    email: record.email,
    roles: record.roles,
    active: record.active,
    invited_at: record.invitedAt,
    updated_at: record.updatedAt,
    on_distribution_list: record.onDistributionList,
  };
}

/**
 * Postgres adapter for the `users` table — the Edge Function analog of
 * functions/src/access/firestoreUserRepository.ts. Thin by design: business rules (the
 * Workspace-domain check, allowlist enforcement, role dedup, etc.) live in accessService.ts,
 * not here — this class only translates between `UserRecord` and `users` table rows.
 *
 * Takes an injected `SupabaseClient` (mirrors `FirestoreUserRepository`'s injected
 * `Firestore` db) rather than constructing its own — production wiring uses
 * `serviceRoleClient()` below; tests inject a fake.
 */
export class PostgresUserRepository implements UserRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getUser(email: string): Promise<UserRecord | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load user ${email}: ${error.message}`);
    }
    return data ? fromRow(data as UserRow) : null;
  }

  async putUser(record: UserRecord): Promise<void> {
    const { error } = await this.client.from(TABLE).upsert(toRow(record));
    if (error) {
      throw new Error(`Failed to save user ${record.email}: ${error.message}`);
    }
  }

  async listUsers(): Promise<UserRecord[]> {
    const { data, error } = await this.client.from(TABLE).select("*");
    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }
    return (data as UserRow[]).map(fromRow);
  }
}

// Lazily created and cached across requests handled by the same warm Deno isolate —
// mirrors callableHandler.ts's getSupabaseClient caching, one module-load per isolate
// rather than per-request. Uses the service_role key (auto-provided to every Edge Function
// as SUPABASE_SERVICE_ROLE_KEY, per scheduledHandler.ts's verifyScheduledSecret comment) so
// this repository bypasses the `users` table's RLS, which denies anon/authenticated
// entirely — the same server-side-only trust boundary the Firebase Admin SDK gives
// functions/src/callableHandler.ts's repository() today.
let cachedServiceRoleClient: SupabaseClient | undefined;

export function serviceRoleClient(): SupabaseClient {
  if (!cachedServiceRoleClient) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    cachedServiceRoleClient = createClient(supabaseUrl, serviceRoleKey);
  }
  return cachedServiceRoleClient;
}
