import { env } from "../../../config/env.js";
import { ConsoleEmailProvider } from "./console.provider.js";
import { ResendEmailProvider } from "./resend.provider.js";
import { SmtpEmailProvider } from "./smtp.provider.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  tags?: Record<string, string>;
}

export interface SendOptions {
  /** Provider-side dedupe key so a retried job never sends twice. */
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage, opts: SendOptions): Promise<{ id: string }>;
}

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    switch (env.EMAIL_DRIVER) {
      case "resend":
        provider = new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM);
        break;
      case "smtp":
        provider = new SmtpEmailProvider(env.SMTP_URL, env.EMAIL_FROM);
        break;
      case "console":
        provider = new ConsoleEmailProvider();
        break;
    }
  }
  return provider;
}
