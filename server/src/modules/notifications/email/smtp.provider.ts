import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailProvider, SendOptions } from "./provider.js";

/** Local development: delivers to Mailpit (UI at http://localhost:8025). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(msg: EmailMessage, opts: SendOptions): Promise<{ id: string }> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: { "X-Idempotency-Key": opts.idempotencyKey },
    });
    return { id: info.messageId };
  }
}
