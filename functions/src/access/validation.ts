import { isRole, type Role } from "@liveoakv3/shared";
import { InvalidArgumentError } from "./errors.ts";

/** Validates untyped callable-function input at the boundary — casts alone don't check the actual runtime value. */
export function parseEmail(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidArgumentError("email must be a non-empty string");
  }
  return value;
}

export function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) {
    throw new InvalidArgumentError("roles must be an array");
  }
  return value.map((item) => {
    if (typeof item !== "string" || !isRole(item)) {
      throw new InvalidArgumentError(`"${String(item)}" is not a valid role`);
    }
    return item;
  });
}

export function parseOnDistributionList(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new InvalidArgumentError("onDistributionList must be a boolean");
  }
  return value;
}
