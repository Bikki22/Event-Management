import { UnrecoverableError } from "bullmq";
import { Resend } from "resend";
import type { EmailMessage, EmailProvider, SendOptions } from "./provider.js";

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(msg: EmailMessage, opts: SendOptions): Promise<{ id: string }> {
    const { data, error } = await this.client.emails.send(
      {
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        tags: msg.tags
          ? Object.entries(msg.tags).map(([name, value]) => ({ name, value }))
          : undefined,
      },
      { idempotencyKey: opts.idempotencyKey },
    );

    if (error) {
      const status = error.statusCode ?? 0;
      const message = `Resend ${status || "error"} ${error.name}: ${error.message}`;
      // 4xx (bad address, unverified domain, invalid key) won't succeed on retry; 429/5xx/network will.
      if (status >= 400 && status < 500 && status !== 429) throw new UnrecoverableError(message);
      throw new Error(message);
    }
    return { id: data.id };
  }
}
