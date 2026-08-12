import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "../access/errors.js";
import { parseCreateJobRecordInput } from "./validation.js";

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: "DISPATCH-123",
    address: "123 Main St",
    workCode: "WC-01",
    footage: 100,
    photoUrls: ["a", "b", "c"],
    notes: "fine",
    isNewBuild: false,
    submittedAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("parseCreateJobRecordInput", () => {
  it("returns a well-formed payload as-is", () => {
    expect(parseCreateJobRecordInput(validPayload())).toEqual({
      jobId: "DISPATCH-123",
      address: "123 Main St",
      workCode: "WC-01",
      footage: 100,
      photoUrls: ["a", "b", "c"],
      notes: "fine",
      isNewBuild: false,
      submittedAt: "2026-01-01T12:00:00.000Z",
    });
  });

  it("defaults a missing notes field to an empty string", () => {
    const payload = validPayload();
    delete payload.notes;
    expect(parseCreateJobRecordInput(payload).notes).toBe("");
  });

  it("rejects a non-object payload", () => {
    expect(() => parseCreateJobRecordInput("nope")).toThrow(InvalidArgumentError);
    expect(() => parseCreateJobRecordInput(null)).toThrow(InvalidArgumentError);
    expect(() => parseCreateJobRecordInput(undefined)).toThrow(InvalidArgumentError);
  });

  it("rejects a non-string jobId", () => {
    expect(() => parseCreateJobRecordInput(validPayload({ jobId: 123 }))).toThrow(
      InvalidArgumentError,
    );
  });

  it("rejects a non-whole-number footage", () => {
    expect(() => parseCreateJobRecordInput(validPayload({ footage: "100" }))).toThrow(
      InvalidArgumentError,
    );
    expect(() => parseCreateJobRecordInput(validPayload({ footage: 10.5 }))).toThrow(
      InvalidArgumentError,
    );
  });

  it("rejects photoUrls that isn't an array of strings", () => {
    expect(() =>
      parseCreateJobRecordInput(validPayload({ photoUrls: "not-an-array" })),
    ).toThrow(InvalidArgumentError);
    expect(() =>
      parseCreateJobRecordInput(validPayload({ photoUrls: ["a", 2, "c"] })),
    ).toThrow(InvalidArgumentError);
  });

  it("rejects a non-boolean isNewBuild", () => {
    expect(() =>
      parseCreateJobRecordInput(validPayload({ isNewBuild: "false" })),
    ).toThrow(InvalidArgumentError);
  });

  it("rejects a missing submittedAt", () => {
    const payload = validPayload();
    delete payload.submittedAt;
    expect(() => parseCreateJobRecordInput(payload)).toThrow(InvalidArgumentError);
  });
});
