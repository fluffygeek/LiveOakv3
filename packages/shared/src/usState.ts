const US_STATE_CODES: ReadonlySet<string> = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
]);

// A US address conventionally ends "<state abbreviation> <ZIP>[-<+4>]" —
// this looks for that trailing shape rather than requiring a specific comma
// layout, so it matches both "..., Springfield, IL 62704" and
// "..., Springfield IL 62704" alike.
const TRAILING_STATE_ZIP = /\b([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$/;

/**
 * Best-effort extraction of a USPS state abbreviation from a free-text Job
 * Record address (this repo has no structured/vendor-verified address
 * components yet — ADR-0002's vendor is still unselected). Returns null
 * when no recognizable "<state> <ZIP>" tail is found, or the matched code
 * isn't a real US state/DC abbreviation.
 */
export function extractStateCode(address: string): string | null {
  const match = address.match(TRAILING_STATE_ZIP);
  if (!match) return null;
  const code = match[1].toUpperCase();
  return US_STATE_CODES.has(code) ? code : null;
}
