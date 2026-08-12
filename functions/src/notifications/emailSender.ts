export interface EmailMessage {
  to: string[];
  subject: string;
  body: string;
}

/** Port onto a third-party email-delivery vendor — no vendor chosen yet (see NotConfiguredEmailSender). */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
