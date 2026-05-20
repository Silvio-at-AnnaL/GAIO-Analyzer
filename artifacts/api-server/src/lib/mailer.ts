import nodemailer from "nodemailer";
import { getSetting } from "./admin-db.js";
import { logger } from "./logger.js";

export interface MailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  bcc?: string;
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
}

function getMailSettings() {
  return {
    host:        getSetting("mail_host")         ?? "",
    port:        parseInt(getSetting("mail_port") ?? "587", 10),
    secure:      getSetting("mail_secure")        === "true",
    user:        getSetting("mail_user")          ?? "",
    password:    getSetting("mail_password")      ?? "",
    fromName:    getSetting("mail_from_name")     ?? "GAIO Analyzer",
    fromAddress: getSetting("mail_from_address")  ?? "",
  };
}

export async function sendMail(opts: MailOptions): Promise<{ success: boolean; fallback?: boolean; error?: string }> {
  const s = getMailSettings();

  if (!s.host) {
    logger.info({ to: opts.to, subject: opts.subject }, "[MAIL FALLBACK] No SMTP configured");
    return { success: true, fallback: true };
  }

  try {
    const transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: { user: s.user, pass: s.password },
    });

    await transport.sendMail({
      from:        `"${s.fromName}" <${s.fromAddress}>`,
      to:          opts.to,
      subject:     opts.subject,
      html:        opts.html ?? opts.text,
      text:        opts.text,
      bcc:         opts.bcc ?? undefined,
      attachments: opts.attachments?.map((a) => ({
        filename:    a.filename,
        content:     a.content,
        contentType: a.contentType ?? "text/html",
      })),
    });

    return { success: true, fallback: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "sendMail failed");
    return { success: false, error };
  }
}
