import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "../access/errors.ts";
import {
  parseCreateJobRecordInput,
  parseEditJobRecordPatch,
  parseRecordId,
  parseSetDiscrepancyInput,
  parseSetFlagInput,
  parseUnlinkDuplicateInput,
  parseWeeklyListInput,
} from "./validation.ts";

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

describe("parseRecordId", () => {
  it("returns a valid recordId", () => {
    expect(parseRecordId({ recordId: "record-1" })).toBe("record-1");
  });

  it("rejects a missing recordId", () => {
    expect(() => parseRecordId({})).toThrow(InvalidArgumentError);
  });

  it("rejects a non-object payload", () => {
    expect(() => parseRecordId("nope")).toThrow(InvalidArgumentError);
  });
});

describe("parseEditJobRecordPatch", () => {
  it("only includes fields present in the payload", () => {
    const { recordId, patch } = parseEditJobRecordPatch({
      recordId: "record-1",
      footage: 150,
    });
    expect(recordId).toBe("record-1");
    expect(patch).toEqual({ footage: 150 });
  });

  it("parses every editable field when present", () => {
    const { patch } = parseEditJobRecordPatch({
      recordId: "record-1",
      jobId: "DISPATCH-1",
      address: "1 Main St",
      workCode: "WC-01",
      footage: 10,
      photoUrls: ["a"],
      notes: "note",
    });
    expect(patch).toEqual({
      jobId: "DISPATCH-1",
      address: "1 Main St",
      workCode: "WC-01",
      footage: 10,
      photoUrls: ["a"],
      notes: "note",
    });
  });

  it("rejects a non-whole-number footage", () => {
    expect(() =>
      parseEditJobRecordPatch({ recordId: "record-1", footage: 1.5 }),
    ).toThrow(InvalidArgumentError);
  });

  it("rejects a missing recordId", () => {
    expect(() => parseEditJobRecordPatch({ footage: 1 })).toThrow(InvalidArgumentError);
  });
});

describe("parseSetDiscrepancyInput", () => {
  it("parses an active discrepancy with a reason", () => {
    expect(
      parseSetDiscrepancyInput({ recordId: "record-1", active: true, reason: "ADDRESS" }),
    ).toEqual({ recordId: "record-1", active: true, reason: "ADDRESS" });
  });

  it("defaults a missing/null reason to null", () => {
    expect(
      parseSetDiscrepancyInput({ recordId: "record-1", active: false }),
    ).toEqual({ recordId: "record-1", active: false, reason: null });
    expect(
      parseSetDiscrepancyInput({ recordId: "record-1", active: false, reason: null }),
    ).toEqual({ recordId: "record-1", active: false, reason: null });
  });

  it("rejects a non-boolean active", () => {
    expect(() =>
      parseSetDiscrepancyInput({ recordId: "record-1", active: "true" }),
    ).toThrow(InvalidArgumentError);
  });
});

describe("parseSetFlagInput", () => {
  it("parses recordId and value", () => {
    expect(parseSetFlagInput({ recordId: "record-1", value: true })).toEqual({
      recordId: "record-1",
      value: true,
    });
  });

  it("rejects a non-boolean value", () => {
    expect(() => parseSetFlagInput({ recordId: "record-1", value: "yes" })).toThrow(
      InvalidArgumentError,
    );
  });
});

describe("parseWeeklyListInput", () => {
  it("defaults weekOffset to 0 when absent", () => {
    expect(parseWeeklyListInput({})).toEqual({ weekOffset: 0 });
  });

  it("parses a provided weekOffset", () => {
    expect(parseWeeklyListInput({ weekOffset: -2 })).toEqual({ weekOffset: -2 });
  });

  it("rejects a non-integer weekOffset", () => {
    expect(() => parseWeeklyListInput({ weekOffset: 1.5 })).toThrow(InvalidArgumentError);
  });
});

describe("parseUnlinkDuplicateInput", () => {
  it("parses recordId and otherRecordId", () => {
    expect(
      parseUnlinkDuplicateInput({ recordId: "record-a", otherRecordId: "record-b" }),
    ).toEqual({ recordId: "record-a", otherRecordId: "record-b" });
  });

  it("rejects a missing otherRecordId", () => {
    expect(() => parseUnlinkDuplicateInput({ recordId: "record-a" })).toThrow(
      InvalidArgumentError,
    );
  });
});
