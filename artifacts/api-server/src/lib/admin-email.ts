import { logger } from "./logger.js";

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(opts: MailOptions): Promise<void> {
  logger.info(
    { to: opts.to, subject: opts.subject },
    `[EMAIL] ${opts.subject}\n---\n${opts.text}\n---`
  );
}
