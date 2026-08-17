import type { AddressVerificationResult, AddressVerifier } from "./addressVerifier.ts";

/** Test double — never used by production code. */
export class FakeAddressVerifier implements AddressVerifier {
  constructor(
    private readonly behavior:
      | { type: "match"; normalizedAddress: string }
      | { type: "noMatch" }
      | { type: "throw"; error: Error } = { type: "match", normalizedAddress: "NORMALIZED" },
  ) {}

  async verify(_address: string): Promise<AddressVerificationResult> {
    if (this.behavior.type === "throw") {
      throw this.behavior.error;
    }
    if (this.behavior.type === "noMatch") {
      return { matched: false, normalizedAddress: null };
    }
    return { matched: true, normalizedAddress: this.behavior.normalizedAddress };
  }
}
