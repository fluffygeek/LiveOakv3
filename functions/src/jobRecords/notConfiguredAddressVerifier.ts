import type { AddressVerificationResult, AddressVerifier } from "./addressVerifier.ts";

/**
 * Placeholder pending a real vendor integration (ADR-0002 shortlists Smarty,
 * Lob, and Melissa — none chosen yet). Always reports no-match, which
 * resolveAddressVerification() in jobRecordService.ts already treats as
 * "unverified, not blocking" — the correct behavior for an unconfigured
 * verifier, since it must never claim to have checked an address it hasn't.
 */
export class NotConfiguredAddressVerifier implements AddressVerifier {
  async verify(_address: string): Promise<AddressVerificationResult> {
    return { matched: false, normalizedAddress: null };
  }
}
