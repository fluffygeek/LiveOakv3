import { describe, expect, it } from "vitest";
import { normalizeAddress } from "./address.js";

describe("normalizeAddress", () => {
  it("uppercases the address", () => {
    expect(normalizeAddress("123 main st")).toBe("123 MAIN ST");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeAddress("  123 Main St  ")).toBe("123 MAIN ST");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeAddress("123   Main    St")).toBe("123 MAIN ST");
  });
});
