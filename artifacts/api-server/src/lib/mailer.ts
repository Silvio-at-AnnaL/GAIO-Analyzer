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

async function getMailSettings() {
  return {
    host:        await getSetting("mail_host")         ?? "",
    port:        parseInt(await getSetting("mail_port") ?? "587", 10),
    secure:      (await getSetting("mail_secure"))     === "true",
    user:        await getSetting("mail_user")         ?? "",
    password:    await getSetting("mail_password")     ?? "",
    fromName:    await getSetting("mail_from_name")    ?? "GAIO Analyzer",
    fromAddress: await getSetting("mail_from_address") ?? "",
  };
}

export async function sendMail(opts: MailOptions): Promise<{ success: boolean; fallback?: boolean; error?: string }> {
  const s = await getMailSettings();

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
    } as Parameters<typeof nodemailer.createTransport>[0]);

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
        contentType: a.contentType,
      })),
    });
    return { success: true };
  } catch (err) {
    logger.error({ err }, "sendMail error");
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
