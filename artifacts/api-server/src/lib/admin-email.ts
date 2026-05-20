import { sendMail } from "./mailer.js";
import { logger } from "./logger.js";

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(opts: MailOptions): Promise<void> {
  const result = await sendMail({ to: opts.to, subject: opts.subject, text: opts.text, html: opts.text });
  if (result.fallback) {
    logger.info({ to: opts.to, subject: opts.subject }, `[EMAIL FALLBACK] ${opts.subject}\n${opts.text}`);
  }
}
