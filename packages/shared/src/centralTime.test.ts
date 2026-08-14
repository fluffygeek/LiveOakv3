import { describe, expect, it } from "vitest";
import { isCentralWallClockTime } from "./centralTime.js";

describe("isCentralWallClockTime", () => {
  it("matches 8pm Central (CST, UTC-6) before the spring-forward transition", () => {
    // 2026-03-01 20:00 CST == 2026-03-02 02:00 UTC.
    expect(isCentralWallClockTime("2026-03-02T02:00:00.000Z", 20, 0)).toBe(true);
  });

  it("matches 8pm Central (CDT, UTC-5) after the spring-forward transition", () => {
    // 2026-03-08 02:00 local is when CST -> CDT happens (second Sunday of March).
    // 2026-03-15 20:00 CDT == 2026-03-16 01:00 UTC.
    expect(isCentralWallClockTime("2026-03-16T01:00:00.000Z", 20, 0)).toBe(true);
  });

  it("does not match the pre-transition UTC offset once CDT is in effect", () => {
    // The CST offset (UTC-6) would guess 02:00 UTC for 8pm local — wrong once DST starts.
    expect(isCentralWallClockTime("2026-03-16T02:00:00.000Z", 20, 0)).toBe(false);
  });

  it("matches 8pm Central (CDT, UTC-5) before the fall-back transition", () => {
    // 2026-10-25 20:00 CDT == 2026-10-26 01:00 UTC.
    expect(isCentralWallClockTime("2026-10-26T01:00:00.000Z", 20, 0)).toBe(true);
  });

  it("matches 8pm Central (CST, UTC-6) after the fall-back transition", () => {
    // 2026-11-01 02:00 local is when CDT -> CST happens (first Sunday of November).
    // 2026-11-08 20:00 CST == 2026-11-09 02:00 UTC.
    expect(isCentralWallClockTime("2026-11-09T02:00:00.000Z", 20, 0)).toBe(true);
  });

  it("does not match the pre-transition UTC offset once CST is back in effect", () => {
    // The CDT offset (UTC-5) would guess 01:00 UTC for 8pm local — wrong once DST ends.
    expect(isCentralWallClockTime("2026-11-09T01:00:00.000Z", 20, 0)).toBe(false);
  });

  it("rejects a minute just before the target", () => {
    expect(isCentralWallClockTime("2026-03-02T01:59:00.000Z", 20, 0)).toBe(false);
  });

  it("rejects a minute just after the target", () => {
    expect(isCentralWallClockTime("2026-03-02T02:01:00.000Z", 20, 0)).toBe(false);
  });

  it("matches a non-zero target minute", () => {
    // 2026-03-01 20:05 CST == 2026-03-02 02:05 UTC.
    expect(isCentralWallClockTime("2026-03-02T02:05:00.000Z", 20, 5)).toBe(true);
  });

  describe("the fall-back transition's repeated local hour (1:00-1:59am occurs twice)", () => {
    // 2026-11-01 02:00 CDT is when clocks fall back to 01:00 CST — so 1:30am Central
    // happens once as 2026-11-01T06:30:00Z (CDT) and again as 2026-11-01T07:30:00Z (CST).
    // A pg_cron job firing every UTC minute hits both instants; a naive wall-clock-text
    // match would report both as 1:30am and fire twice. This must pick exactly one.

    it("does not match the first (CDT) occurrence of the repeated hour", () => {
      expect(isCentralWallClockTime("2026-11-01T06:30:00.000Z", 1, 30)).toBe(false);
    });

    it("matches the second (CST) occurrence of the repeated hour", () => {
      expect(isCentralWallClockTime("2026-11-01T07:30:00.000Z", 1, 30)).toBe(true);
    });

    it("fires at most once across every UTC minute spanning both occurrences", () => {
      const matches: string[] = [];
      for (let minute = 0; minute < 120; minute++) {
        const nowIso = new Date(Date.UTC(2026, 10, 1, 6, 0, 0) + minute * 60_000).toISOString();
        if (isCentralWallClockTime(nowIso, 1, 30)) matches.push(nowIso);
      }
      expect(matches).toHaveLength(1);
    });
  });

  it("returns a deterministic boolean for the spring-forward skipped hour (2:00-2:59am doesn't exist locally that day)", () => {
    // 2026-03-08 02:00 local is skipped entirely (clocks jump 2:00 -> 3:00 CST -> CDT).
    // There's no real "2:30am Central" that day; this just must not throw either way.
    expect(() => isCentralWallClockTime("2026-03-08T08:30:00.000Z", 2, 30)).not.toThrow();
  });
});
