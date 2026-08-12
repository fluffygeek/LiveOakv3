import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "./errors.js";
import { parseEmail, parseOnDistributionList, parseRoles } from "./validation.js";

describe("parseEmail", () => {
  it("returns a non-empty string as-is", () => {
    expect(parseEmail("person@example.com")).toBe("person@example.com");
  });

  it("rejects a non-string value", () => {
    expect(() => parseEmail(42)).toThrow(InvalidArgumentError);
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(() => parseEmail("   ")).toThrow(InvalidArgumentError);
  });

  it("rejects undefined", () => {
    expect(() => parseEmail(undefined)).toThrow(InvalidArgumentError);
  });
});

describe("parseRoles", () => {
  it("returns a valid roles array as-is", () => {
    expect(parseRoles(["technician", "payrollAdministrator"])).toEqual([
      "technician",
      "payrollAdministrator",
    ]);
  });

  it("rejects a non-array value", () => {
    expect(() => parseRoles("technician")).toThrow(InvalidArgumentError);
  });

  it("rejects an array containing a role not in the known set", () => {
    expect(() => parseRoles(["technician", "superAdmin"])).toThrow(
      InvalidArgumentError,
    );
  });

  it("rejects an array containing a non-string element", () => {
    expect(() => parseRoles(["technician", 42])).toThrow(InvalidArgumentError);
  });

  it("accepts an empty array", () => {
    expect(parseRoles([])).toEqual([]);
  });
});

describe("parseOnDistributionList", () => {
  it("returns a boolean as-is", () => {
    expect(parseOnDistributionList(true)).toBe(true);
    expect(parseOnDistributionList(false)).toBe(false);
  });

  it("rejects a non-boolean value", () => {
    expect(() => parseOnDistributionList("true")).toThrow(InvalidArgumentError);
  });
});
