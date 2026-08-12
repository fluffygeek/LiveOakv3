export interface WorkCode {
  code: string;
  description: string;
  minPhotos: number;
}

/**
 * Placeholder table — replace with the real work codes before build.
 * See docs/agents/domain.md and the spec #3 grilling notes.
 */
export const WORK_CODES: readonly WorkCode[] = [
  { code: "WC-01", description: "Placeholder — e.g. trenching/burial", minPhotos: 3 },
  { code: "WC-02", description: "Placeholder — e.g. splice/connection", minPhotos: 4 },
  { code: "WC-03", description: "Placeholder — e.g. aerial install", minPhotos: 3 },
  { code: "WC-04", description: "Placeholder — e.g. repair", minPhotos: 5 },
];

export function findWorkCode(code: string): WorkCode | undefined {
  return WORK_CODES.find((workCode) => workCode.code === code);
}
