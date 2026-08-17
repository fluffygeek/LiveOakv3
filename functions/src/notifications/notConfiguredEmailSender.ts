import type { EmailMessage, EmailSender } from "./emailSender.ts";

/**
 * Placeholder pending a real email-delivery vendor (none chosen or scoped
 * for this spec — mirrors NotConfiguredAddressVerifier's stance in
 * ../jobRecords/notConfiguredAddressVerifier.ts on ADR-0002's unselected
 * vendor). No-ops rather than throwing: a nightly scheduled job failing
 * loudly every night before a vendor exists would be pure noise, and unlike
 * address verification there's no "unverified" fallback state to record —
 * it simply doesn't send until a real sender is wired in.
 */
export class NotConfiguredEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<void> {
    // Intentionally a no-op.
  }
}
