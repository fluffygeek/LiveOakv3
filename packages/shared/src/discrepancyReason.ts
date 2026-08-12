export interface DiscrepancyReason {
  code: string;
  description: string;
}

/**
 * Placeholder table — replace with the real discrepancy reasons before build.
 * See docs/agents/domain.md and the spec #4 grilling notes.
 */
export const DISCREPANCY_REASONS: readonly DiscrepancyReason[] = [
  { code: "ADDRESS", description: "Placeholder — e.g. address mismatch" },
  { code: "FOOTAGE", description: "Placeholder — e.g. footage looks wrong" },
  { code: "WORK_CODE", description: "Placeholder — e.g. incorrect work code" },
  { code: "PHOTOS", description: "Placeholder — e.g. photos insufficient/unclear" },
  { code: "OTHER", description: "Placeholder — anything not covered above" },
];

export function findDiscrepancyReason(code: string): DiscrepancyReason | undefined {
  return DISCREPANCY_REASONS.find((reason) => reason.code === code);
}
