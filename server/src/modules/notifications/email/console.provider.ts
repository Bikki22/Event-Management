import { randomUUID } from "node:crypto";
import { logger } from "../../../lib/logger.js";
import type { EmailMessage, EmailProvider } from "./provider.js";

/** Tests / no-infra mode: just logs the message. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  readonly sent: EmailMessage[] = [];

  async send(msg: EmailMessage): Promise<{ id: string }> {
    this.sent.push(msg);
    logger.info({ to: msg.to, subject: msg.subject }, "email (console driver)");
    logger.debug(msg.text);
    return { id: randomUUID() };
  }
}
