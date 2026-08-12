export interface AddressVerificationResult {
  matched: boolean;
  /** Vendor-standardized address, present only when matched is true. */
  normalizedAddress: string | null;
}

/** Port onto the third-party address-verification vendor (ADR-0002) — never call USPS's own API directly. */
export interface AddressVerifier {
  verify(address: string): Promise<AddressVerificationResult>;
}
