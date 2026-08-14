const TIME_ZONE = "America/Chicago";

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

function partsOf(date: Date): Record<string, string> {
  return Object.fromEntries(instantFormatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/**
 * Central-time UTC offset (ms, local = UTC + offset) in effect at the given guess instant,
 * per the actual IANA timezone data — DST-aware, not a fixed offset. Mirrors
 * `easternOffsetMs`'s guess-then-correct technique in easternWeek.ts.
 */
function centralOffsetMs(guessInstant: Date): number {
  const parts = partsOf(guessInstant);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - guessInstant.getTime();
}

/**
 * The UTC instant for `targetHour`:`targetMinute` Central time on the Central calendar date
 * containing `nowIso`. Always resolves to exactly one specific instant per calendar day —
 * critical during the fall-back transition, when that local time occurs twice (once CDT,
 * once CST): guessing with the standard-time (CST, UTC-6) offset and reading the true
 * offset at that guess deterministically picks the second (CST) occurrence, rather than
 * "does the wall clock currently read HH:MM" — which would match both, once each hour.
 * (The spring-forward skipped hour has no real local occurrence at all; this still returns
 * a single instant, but which one is unspecified — no caller in this codebase targets a
 * time inside 01:00-02:59 Central, the only hour that's ever ambiguous or skipped.)
 */
function centralTargetInstantMs(nowIso: string, targetHour: number, targetMinute: number): number {
  const nowParts = partsOf(new Date(nowIso));
  const year = Number(nowParts.year);
  const month = Number(nowParts.month) - 1;
  const day = Number(nowParts.day);
  const cstGuess = new Date(Date.UTC(year, month, day, targetHour + 6, targetMinute, 0));
  const offsetMs = centralOffsetMs(cstGuess);
  return Date.UTC(year, month, day, targetHour, targetMinute, 0) - offsetMs;
}

/**
 * Whether `nowIso` falls in the same UTC minute as `targetHour`:`targetMinute`
 * America/Chicago wall-clock time on nowIso's Central calendar date — DST-correct via the
 * ICU timezone database (same technique as `easternWeekWindow`), not a fixed UTC offset,
 * and resolves to exactly one instant per day even across the fall-back transition (see
 * `centralTargetInstantMs`). Pairs with a pg_cron job scheduled every minute in UTC:
 * managed Supabase doesn't expose `cron.timezone` (see the migration this backs), so the
 * schedule itself can't run natively in Central time — this check is what makes exactly one
 * of those per-minute invocations a day the real one.
 */
export function isCentralWallClockTime(
  nowIso: string,
  targetHour: number,
  targetMinute: number,
): boolean {
  const now = new Date(nowIso);
  const target = centralTargetInstantMs(nowIso, targetHour, targetMinute);
  return Math.floor(now.getTime() / 60_000) === Math.floor(target / 60_000);
}
