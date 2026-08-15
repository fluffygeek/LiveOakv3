import { useCallback, useEffect, useState, type FormEvent } from "react";
import { isDistributionListEligibleRole, ROLES, type Role, type UserRecord } from "@liveoakv3/shared";
import { supabase } from "../supabase";

/**
 * Invokes a `supabase.functions.invoke` Edge Function call and unwraps its `{ data, error }`
 * result into a resolved value or a thrown error — the same unwrapping pattern
 * apps/web/src/auth/useAuth.ts uses for `resolveMyAccess`, factored here since every call
 * site below (listUsers, inviteUser, updateUserRoles, revokeUser,
 * setDistributionListMembership) needs it identically.
 */
async function invoke<TResult>(
  name: string,
  body?: Record<string, unknown>,
): Promise<TResult> {
  const { data, error } = await supabase.functions.invoke<TResult>(name, {
    body,
  });
  if (error) {
    throw error;
  }
  if (data === null || data === undefined) {
    throw new Error(`${name} returned no data`);
  }
  return data;
}

const listUsersFn = () => invoke<UserRecord[]>("listUsers");
const inviteUserFn = (body: { email: string; roles: Role[] }) =>
  invoke<UserRecord>("inviteUser", body);
const updateUserRolesFn = (body: { email: string; roles: Role[] }) =>
  invoke<UserRecord>("updateUserRoles", body);
const revokeUserFn = (body: { email: string }) =>
  invoke<{ revoked: boolean }>("revokeUser", body);
const setDistributionListMembershipFn = (body: {
  email: string;
  onDistributionList: boolean;
}) => invoke<UserRecord>("setDistributionListMembership", body);

export function ManageUsersScreen() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<Role[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listUsersFn();
      setUsers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inviteEmail || inviteRoles.length === 0) return;
    await inviteUserFn({ email: inviteEmail, roles: inviteRoles });
    setInviteEmail("");
    setInviteRoles([]);
    await refresh();
  };

  const toggleRole = async (email: string, role: Role, currentRoles: Role[]) => {
    const nextRoles = currentRoles.includes(role)
      ? currentRoles.filter((r) => r !== role)
      : [...currentRoles, role];
    await updateUserRolesFn({ email, roles: nextRoles });
    await refresh();
  };

  const handleRevoke = async (email: string) => {
    await revokeUserFn({ email });
    await refresh();
  };

  const toggleDistributionList = async (email: string, onDistributionList: boolean) => {
    await setDistributionListMembershipFn({ email, onDistributionList });
    await refresh();
  };

  return (
    <section>
      <h2>Manage users</h2>

      <form onSubmit={handleInvite}>
        <input
          type="email"
          placeholder="name@company.com"
          value={inviteEmail}
          onChange={(event) => setInviteEmail(event.target.value)}
          required
        />
        {ROLES.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={inviteRoles.includes(role)}
              onChange={() =>
                setInviteRoles((prev) =>
                  prev.includes(role)
                    ? prev.filter((r) => r !== role)
                    : [...prev, role],
                )
              }
            />
            {role}
          </label>
        ))}
        <button type="submit">Invite</button>
      </form>

      {error ? <p role="alert">{error}</p> : null}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Roles</th>
              <th>Distribution List</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const distributionListEligible = isDistributionListEligibleRole(user.roles);
              return (
              <tr key={user.email}>
                <td>{user.email}</td>
                <td>
                  {ROLES.map((role) => (
                    <label key={role}>
                      <input
                        type="checkbox"
                        checked={user.roles.includes(role)}
                        onChange={() => void toggleRole(user.email, role, user.roles)}
                      />
                      {role}
                    </label>
                  ))}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={user.onDistributionList}
                    disabled={!distributionListEligible}
                    title={
                      distributionListEligible
                        ? undefined
                        : "Requires the Payroll Administrator or Application Administrator role"
                    }
                    onChange={() =>
                      void toggleDistributionList(user.email, !user.onDistributionList)
                    }
                  />
                </td>
                <td>{user.active ? "Active" : "Revoked"}</td>
                <td>
                  {user.active ? (
                    <button onClick={() => void handleRevoke(user.email)}>
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
