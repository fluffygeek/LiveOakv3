import { describe, expect, it } from "vitest";
import { isAllowedWorkspaceDomain } from "./workspaceDomain.js";

describe("isAllowedWorkspaceDomain", () => {
  it("allows an email on the configured domain", () => {
    expect(isAllowedWorkspaceDomain("tech@example.com", "example.com")).toBe(
      true,
    );
  });

  it("rejects an email on a different domain", () => {
    expect(isAllowedWorkspaceDomain("tech@gmail.com", "example.com")).toBe(
      false,
    );
  });

  it("is case-insensitive on both the email and the configured domain", () => {
    expect(
      isAllowedWorkspaceDomain("Tech@Example.COM", "EXAMPLE.com"),
    ).toBe(true);
  });

  it("rejects an email with no @ sign", () => {
    expect(isAllowedWorkspaceDomain("not-an-email", "example.com")).toBe(
      false,
    );
  });
});
