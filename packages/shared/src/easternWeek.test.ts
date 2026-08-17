import { describe, expect, it } from "vitest";
import { easternWeekWindow } from "./easternWeek.ts";

describe("easternWeekWindow", () => {
  it("returns the Sun-Sat Eastern window (EST, UTC-5) containing a mid-week instant", () => {
    // 2026-01-06 is a Tuesday; the containing week is Sun 2026-01-04 .. Sun 2026-01-11.
    const window = easternWeekWindow("2026-01-06T12:00:00.000Z");
    expect(window).toEqual({
      startIso: "2026-01-04T05:00:00.000Z",
      endIso: "2026-01-11T05:00:00.000Z",
    });
  });

  it("treats a Sunday instant itself as the start of that week, not the prior week", () => {
    // 2026-01-04T12:00:00Z is Sunday 07:00 Eastern (EST) — still within the week starting that day.
    const window = easternWeekWindow("2026-01-04T12:00:00.000Z");
    expect(window.startIso).toBe("2026-01-04T05:00:00.000Z");
  });

  it("a record submitted just before Sunday midnight ET falls in the prior week", () => {
    const currentWeek = easternWeekWindow("2026-01-06T12:00:00.000Z");
    const priorWeek = easternWeekWindow("2026-01-06T12:00:00.000Z", -1);
    const justBeforeBoundary = new Date(currentWeek.startIso);
    justBeforeBoundary.setUTCMinutes(justBeforeBoundary.getUTCMinutes() - 1);

    expect(justBeforeBoundary.toISOString() >= priorWeek.startIso).toBe(true);
    expect(justBeforeBoundary.toISOString() < priorWeek.endIso).toBe(true);
    expect(justBeforeBoundary.toISOString() < currentWeek.startIso).toBe(true);
  });

  it("a record submitted just after Sunday midnight ET falls in the new week", () => {
    const currentWeek = easternWeekWindow("2026-01-06T12:00:00.000Z");
    const justAfterBoundary = new Date(currentWeek.startIso);
    justAfterBoundary.setUTCMinutes(justAfterBoundary.getUTCMinutes() + 1);

    expect(justAfterBoundary.toISOString() >= currentWeek.startIso).toBe(true);
    expect(justAfterBoundary.toISOString() < currentWeek.endIso).toBe(true);
  });

  it("shifts back by whole weeks for negative weekOffset", () => {
    const window = easternWeekWindow("2026-01-06T12:00:00.000Z", -2);
    expect(window).toEqual({
      startIso: "2025-12-21T05:00:00.000Z",
      endIso: "2025-12-28T05:00:00.000Z",
    });
  });

  it("spans exactly 7 Eastern calendar days across the spring-forward transition (167 elapsed hours)", () => {
    // 2026-03-08 02:00 ET is when EST -> EDT happens (second Sunday of March).
    const window = easternWeekWindow("2026-03-10T12:00:00.000Z"); // a Tuesday inside that week
    expect(window).toEqual({
      startIso: "2026-03-08T05:00:00.000Z", // still EST at Sunday midnight
      endIso: "2026-03-15T04:00:00.000Z", // EDT by the following Sunday midnight
    });
    const elapsedHours =
      (new Date(window.endIso).getTime() - new Date(window.startIso).getTime()) / 3_600_000;
    expect(elapsedHours).toBe(167);
  });

  it("spans exactly 7 Eastern calendar days across the fall-back transition (169 elapsed hours)", () => {
    // 2026-11-01 02:00 ET is when EDT -> EST happens (first Sunday of November).
    const window = easternWeekWindow("2026-11-04T12:00:00.000Z"); // a Wednesday inside that week
    expect(window).toEqual({
      startIso: "2026-11-01T04:00:00.000Z", // still EDT at Sunday midnight
      endIso: "2026-11-08T05:00:00.000Z", // EST by the following Sunday midnight
    });
    const elapsedHours =
      (new Date(window.endIso).getTime() - new Date(window.startIso).getTime()) / 3_600_000;
    expect(elapsedHours).toBe(169);
  });
});
