import { describe, expect, it } from "vitest";
import { extractStateCode } from "./usState.ts";

describe("extractStateCode", () => {
  it("extracts the state from a comma-separated address", () => {
    expect(extractStateCode("123 Main St, Springfield, IL 62704")).toBe("IL");
  });

  it("extracts the state when the city/state aren't comma-separated", () => {
    expect(extractStateCode("123 Main St, Springfield IL 62704")).toBe("IL");
  });

  it("handles a ZIP+4", () => {
    expect(extractStateCode("123 Main St, Springfield, IL 62704-1234")).toBe("IL");
  });

  it("is case-insensitive but returns an uppercase code", () => {
    expect(extractStateCode("123 Main St, Springfield, il 62704")).toBe("IL");
  });

  it("returns null when there's no trailing state/ZIP", () => {
    expect(extractStateCode("123 Main St, Springfield")).toBeNull();
  });

  it("returns null when the two-letter code isn't a real state", () => {
    expect(extractStateCode("123 Main St, Springfield, ZZ 62704")).toBeNull();
  });

  it("returns null for an empty address", () => {
    expect(extractStateCode("")).toBeNull();
  });

  it("doesn't false-positive on a two-letter word earlier in the address", () => {
    expect(extractStateCode("5 IL St, Chicago, IL 62704")).toBe("IL");
  });
});
