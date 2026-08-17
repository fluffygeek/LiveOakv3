import type { EmailMessage, EmailSender } from "./emailSender.ts";

/** Test double — captures every send() call for assertions. Never used by production code. */
export class FakeEmailSender implements EmailSender {
  private readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  all(): EmailMessage[] {
    return [...this.sent];
  }
}
