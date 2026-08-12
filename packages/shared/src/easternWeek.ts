const TIME_ZONE = "America/New_York";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const instantFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function partsOf(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/**
 * Eastern-time UTC offset (ms, local = UTC + offset) in effect at local
 * midnight on the given calendar date.
 *
 * The guess instant is local midnight assuming the EST offset (UTC+5h) —
 * i.e. `05:00 UTC` on that date. That's deliberately NOT a noon-UTC guess:
 * DST flips at 2am *local* (07:00 UTC in EST, 06:00 UTC in EDT), and a noon
 * guess falls after that instant on the transition date itself, reporting
 * the offset that starts a couple hours into the day rather than the one
 * actually in effect at midnight.
 */
function easternOffsetMs(year: number, month: number, day: number): number {
  const midnightGuess = new Date(Date.UTC(year, month - 1, day, 5, 0, 0));
  const parts = partsOf(instantFormatter, midnightGuess);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - midnightGuess.getTime();
}

/** The UTC instant of local midnight in Eastern time on the given calendar date. */
function easternMidnightUtc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 0, 0, 0) - easternOffsetMs(year, month, day);
}

export interface WeekWindow {
  /** Inclusive start — Sunday midnight Eastern time, as a UTC ISO timestamp. */
  startIso: string;
  /** Exclusive end — the following Sunday midnight Eastern time, as a UTC ISO timestamp. */
  endIso: string;
}

/**
 * The Sunday-through-Saturday Eastern-time window containing `nowIso`,
 * shifted by `weekOffset` whole weeks (0 = current week, -1 = the week
 * before, etc.). Week boundaries are computed in Eastern calendar days, so
 * a week that crosses a DST transition still spans exactly 7 local days.
 */
export function easternWeekWindow(nowIso: string, weekOffset = 0): WeekWindow {
  const now = new Date(nowIso);
  const nowParts = partsOf(dateFormatter, now);
  const nowYear = Number(nowParts.year);
  const nowMonth = Number(nowParts.month);
  const nowDay = Number(nowParts.day);

  // Weekday doesn't depend on time-of-day, so treating the Eastern calendar
  // date as a UTC date here is safe purely for day-of-week arithmetic.
  const todayAsUtcDate = Date.UTC(nowYear, nowMonth - 1, nowDay);
  const weekday = new Date(todayAsUtcDate).getUTCDay(); // 0 = Sunday

  const daysToWindowStart = -weekday + weekOffset * 7;
  const startCalendar = new Date(todayAsUtcDate + daysToWindowStart * 86_400_000);
  const startYear = startCalendar.getUTCFullYear();
  const startMonth = startCalendar.getUTCMonth() + 1;
  const startDay = startCalendar.getUTCDate();

  const endCalendar = new Date(startCalendar.getTime() + 7 * 86_400_000);
  const endYear = endCalendar.getUTCFullYear();
  const endMonth = endCalendar.getUTCMonth() + 1;
  const endDay = endCalendar.getUTCDate();

  return {
    startIso: new Date(easternMidnightUtc(startYear, startMonth, startDay)).toISOString(),
    endIso: new Date(easternMidnightUtc(endYear, endMonth, endDay)).toISOString(),
  };
}
