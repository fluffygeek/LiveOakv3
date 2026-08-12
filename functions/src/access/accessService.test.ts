import { beforeEach, describe, expect, it } from "vitest";
import type { UserRecord } from "@liveoakv3/shared";
import {
  AccessDeniedError,
  ForbiddenError,
  InvalidArgumentError,
  LastAdministratorError,
  NotAllowlistedError,
  UserNotFoundError,
} from "./errors.js";
import { InMemoryUserRepository } from "./inMemoryUserRepository.js";
import {
  inviteUser,
  listUsers,
  resolveAccess,
  revokeUser,
  setDistributionListMembership,
  updateUserRoles,
} from "./accessService.js";

const ALLOWED_DOMAIN = "example.com";
const FIXED_NOW = () => "2026-01-01T00:00:00.000Z";

function adminRecord(email: string): UserRecord {
  return {
    email,
    roles: ["applicationAdministrator"],
    active: true,
    invitedAt: FIXED_NOW(),
    updatedAt: FIXED_NOW(),
    onDistributionList: false,
  };
}

describe("resolveAccess", () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it("resolves the roles of an allowlisted, active user on the allowed domain", async () => {
    repo.seed({
      email: "tech@example.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    const result = await resolveAccess(
      repo,
      { allowedWorkspaceDomain: ALLOWED_DOMAIN },
      "tech@example.com",
    );

    expect(result).toEqual({ email: "tech@example.com", roles: ["technician"] });
  });

  it("denies a user on a different domain even if allowlisted under a lookalike record", async () => {
    repo.seed({
      email: "tech@evil.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    await expect(
      resolveAccess(
        repo,
        { allowedWorkspaceDomain: ALLOWED_DOMAIN },
        "tech@evil.com",
      ),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("denies a user on the allowed domain who has not been invited", async () => {
    await expect(
      resolveAccess(
        repo,
        { allowedWorkspaceDomain: ALLOWED_DOMAIN },
        "stranger@example.com",
      ),
    ).rejects.toThrow(NotAllowlistedError);
  });

  it("denies a revoked (inactive) user even though a record exists", async () => {
    repo.seed({
      email: "former@example.com",
      roles: ["technician"],
      active: false,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    await expect(
      resolveAccess(
        repo,
        { allowedWorkspaceDomain: ALLOWED_DOMAIN },
        "former@example.com",
      ),
    ).rejects.toThrow(NotAllowlistedError);
  });

  it("normalizes email casing before lookup", async () => {
    repo.seed({
      email: "tech@example.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    const result = await resolveAccess(
      repo,
      { allowedWorkspaceDomain: ALLOWED_DOMAIN },
      "Tech@Example.com",
    );

    expect(result.email).toBe("tech@example.com");
  });
});

describe("inviteUser", () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it("creates a new active user with exactly the given roles", async () => {
    const record = await inviteUser(
      repo,
      ["applicationAdministrator"],
      "new.tech@example.com",
      ["technician"],
      FIXED_NOW,
    );

    expect(record).toMatchObject({
      email: "new.tech@example.com",
      roles: ["technician"],
      active: true,
    });
    await expect(repo.getUser("new.tech@example.com")).resolves.toMatchObject({
      roles: ["technician"],
    });
  });

  it("grants the union of roles when multiple roles are assigned", async () => {
    const record = await inviteUser(
      repo,
      ["applicationAdministrator"],
      "multi@example.com",
      ["payrollAdministrator", "applicationAdministrator"],
      FIXED_NOW,
    );

    expect(record.roles.sort()).toEqual(
      ["applicationAdministrator", "payrollAdministrator"].sort(),
    );
  });

  it("re-inviting an existing email updates their roles rather than erroring", async () => {
    await inviteUser(
      repo,
      ["applicationAdministrator"],
      "person@example.com",
      ["technician"],
      FIXED_NOW,
    );

    const updated = await inviteUser(
      repo,
      ["applicationAdministrator"],
      "person@example.com",
      ["payrollAdministrator"],
      FIXED_NOW,
    );

    expect(updated.roles).toEqual(["payrollAdministrator"]);
  });

  it("rejects a caller who is not an Application Administrator", async () => {
    await expect(
      inviteUser(repo, ["technician"], "someone@example.com", ["technician"], FIXED_NOW),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("updateUserRoles", () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it("replaces an existing user's roles", async () => {
    repo.seed({
      email: "person@example.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    const updated = await updateUserRoles(
      repo,
      ["applicationAdministrator"],
      "person@example.com",
      ["payrollAdministrator", "applicationAdministrator"],
      FIXED_NOW,
    );

    expect(updated.roles.sort()).toEqual(
      ["applicationAdministrator", "payrollAdministrator"].sort(),
    );
  });

  it("rejects updating a user who was never invited", async () => {
    await expect(
      updateUserRoles(
        repo,
        ["applicationAdministrator"],
        "ghost@example.com",
        ["technician"],
        FIXED_NOW,
      ),
    ).rejects.toThrow(UserNotFoundError);
  });

  it("rejects a caller who is not an Application Administrator", async () => {
    repo.seed({
      email: "person@example.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    await expect(
      updateUserRoles(repo, ["payrollAdministrator"], "person@example.com", ["technician"], FIXED_NOW),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("revokeUser", () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it("deactivates a user so resolveAccess subsequently denies them", async () => {
    repo.seed({
      email: "person@example.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    await revokeUser(repo, ["applicationAdministrator"], "person@example.com", FIXED_NOW);

    await expect(
      resolveAccess(repo, { allowedWorkspaceDomain: ALLOWED_DOMAIN }, "person@example.com"),
    ).rejects.toThrow(NotAllowlistedError);
  });

  it("rejects revoking a user who was never invited", async () => {
    await expect(
      revokeUser(repo, ["applicationAdministrator"], "ghost@example.com", FIXED_NOW),
    ).rejects.toThrow(UserNotFoundError);
  });

  it("rejects a caller who is not an Application Administrator", async () => {
    repo.seed({
      email: "person@example.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    await expect(
      revokeUser(repo, ["payrollAdministrator"], "person@example.com", FIXED_NOW),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("listUsers", () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it("returns every user for an Application Administrator caller", async () => {
    repo.seed(adminRecord("admin@example.com"));
    repo.seed({
      email: "tech@example.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    const users = await listUsers(repo, ["applicationAdministrator"]);

    expect(users.map((u) => u.email).sort()).toEqual([
      "admin@example.com",
      "tech@example.com",
    ]);
  });

  it("rejects a caller who is not an Application Administrator", async () => {
    await expect(listUsers(repo, ["payrollAdministrator"])).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("setDistributionListMembership", () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it("adds a Payroll Administrator to the Distribution List", async () => {
    repo.seed({
      email: "payroll@example.com",
      roles: ["payrollAdministrator"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    const updated = await setDistributionListMembership(
      repo,
      ["applicationAdministrator"],
      "payroll@example.com",
      true,
      FIXED_NOW,
    );

    expect(updated.onDistributionList).toBe(true);
  });

  it("adds an Application Administrator to the Distribution List", async () => {
    repo.seed(adminRecord("admin@example.com"));

    const updated = await setDistributionListMembership(
      repo,
      ["applicationAdministrator"],
      "admin@example.com",
      true,
      FIXED_NOW,
    );

    expect(updated.onDistributionList).toBe(true);
  });

  it("rejects adding a Technician-only user to the Distribution List", async () => {
    repo.seed({
      email: "tech@example.com",
      roles: ["technician"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    await expect(
      setDistributionListMembership(
        repo,
        ["applicationAdministrator"],
        "tech@example.com",
        true,
        FIXED_NOW,
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("allows removing anyone from the Distribution List regardless of role", async () => {
    repo.seed({
      email: "payroll@example.com",
      roles: ["payrollAdministrator"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: true,
    });

    const updated = await setDistributionListMembership(
      repo,
      ["applicationAdministrator"],
      "payroll@example.com",
      false,
      FIXED_NOW,
    );

    expect(updated.onDistributionList).toBe(false);
  });

  it("rejects a caller who is not an Application Administrator", async () => {
    repo.seed({
      email: "payroll@example.com",
      roles: ["payrollAdministrator"],
      active: true,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    await expect(
      setDistributionListMembership(
        repo,
        ["payrollAdministrator"],
        "payroll@example.com",
        true,
        FIXED_NOW,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects a target user who was never invited", async () => {
    await expect(
      setDistributionListMembership(
        repo,
        ["applicationAdministrator"],
        "ghost@example.com",
        true,
        FIXED_NOW,
      ),
    ).rejects.toThrow(UserNotFoundError);
  });
});

describe("last administrator protection", () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it("rejects updateUserRoles that would strip the sole active admin's role", async () => {
    repo.seed(adminRecord("only-admin@example.com"));

    await expect(
      updateUserRoles(
        repo,
        ["applicationAdministrator"],
        "only-admin@example.com",
        ["technician"],
        FIXED_NOW,
      ),
    ).rejects.toThrow(LastAdministratorError);

    await expect(repo.getUser("only-admin@example.com")).resolves.toMatchObject({
      roles: ["applicationAdministrator"],
    });
  });

  it("rejects re-inviting the sole active admin with roles that drop applicationAdministrator", async () => {
    repo.seed(adminRecord("only-admin@example.com"));

    await expect(
      inviteUser(
        repo,
        ["applicationAdministrator"],
        "only-admin@example.com",
        ["payrollAdministrator"],
        FIXED_NOW,
      ),
    ).rejects.toThrow(LastAdministratorError);
  });

  it("rejects revokeUser against the sole active admin", async () => {
    repo.seed(adminRecord("only-admin@example.com"));

    await expect(
      revokeUser(repo, ["applicationAdministrator"], "only-admin@example.com", FIXED_NOW),
    ).rejects.toThrow(LastAdministratorError);

    await expect(repo.getUser("only-admin@example.com")).resolves.toMatchObject({
      active: true,
    });
  });

  it("allows demoting an admin when another active admin remains", async () => {
    repo.seed(adminRecord("admin-one@example.com"));
    repo.seed(adminRecord("admin-two@example.com"));

    const updated = await updateUserRoles(
      repo,
      ["applicationAdministrator"],
      "admin-one@example.com",
      ["technician"],
      FIXED_NOW,
    );

    expect(updated.roles).toEqual(["technician"]);
  });

  it("allows revoking an admin when another active admin remains", async () => {
    repo.seed(adminRecord("admin-one@example.com"));
    repo.seed(adminRecord("admin-two@example.com"));

    await revokeUser(repo, ["applicationAdministrator"], "admin-one@example.com", FIXED_NOW);

    await expect(repo.getUser("admin-one@example.com")).resolves.toMatchObject({
      active: false,
    });
  });

  it("ignores an already-revoked admin when counting remaining admins", async () => {
    repo.seed(adminRecord("only-admin@example.com"));
    repo.seed({
      email: "revoked-admin@example.com",
      roles: ["applicationAdministrator"],
      active: false,
      invitedAt: FIXED_NOW(),
      updatedAt: FIXED_NOW(),
      onDistributionList: false,
    });

    await expect(
      revokeUser(repo, ["applicationAdministrator"], "only-admin@example.com", FIXED_NOW),
    ).rejects.toThrow(LastAdministratorError);
  });
});
