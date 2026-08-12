/** Normalizes an address string into a stable key for Duplicate matching. */
export function normalizeAddress(address: string): string {
  return address.trim().toUpperCase().replace(/\s+/g, " ");
}
