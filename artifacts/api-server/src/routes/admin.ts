import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { load as cheerioLoad } from "cheerio";
import { Client as PgClient } from "pg";
import { getSetting, setSetting, saveAnalysisExport } from "../lib/admin-db.js";
import { query } from "../lib/db.js";
import { sendMail, type MailOptions } from "../lib/mailer.js";
import { signToken, verifyToken, validatePasswordPolicy, generateTempPassword } from "../lib/admin-auth.js";
import { sendEmail } from "../lib/admin-email.js";
import { logger } from "../lib/logger.js";
import { callLLM } from "../lib/ai-client.js";
import { getPrompt, fillTemplate, clearPromptCache } from "../lib/prompt-manager.js";
import { PROMPT_DEFAULTS_MAP } from "../lib/prompt-defaults.js";
import { randomUUID } from "node:crypto";

declare module "express" {
  interface Request {
    adminUser?: { id: number; username: string; role: string };
  }
}

interface DbUser {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: number;
  must_change_pw: number;
  created_at: string;
  created_by: number | null;
  last_login: string | null;
}

function safeUser(u: DbUser) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    firstName: u.first_name,
    lastName: u.last_name,
    role: u.role,
    isActive: u.is_active === 1,
    mustChangePw: u.must_change_pw === 1,
    createdAt: u.created_at,
    lastLogin: u.last_login,
  };
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure: false,
  sameSite: "lax" as const,
  maxAge: 8 * 60 * 60 * 1000,
  path: "/",
};

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.gaio_admin_token;
  if (!token) { res.status(401).json({ error: "Nicht authentifiziert" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Sitzung abgelaufen" }); return; }
  req.adminUser = { id: payload.userId, username: payload.username, role: payload.role };
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.adminUser?.role !== "admin") { res.status(403).json({ error: "Keine Berechtigung" }); return; }
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Zu viele Anmeldeversuche. Bitte warten Sie 15 Minuten." },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminRouter = Router();

interface CustomProviderRecord {
  id: string;
  name: string;
  api_key: string;
  base_url: string;
  model: string;
  enabled: boolean;
}

/** Split a BCC setting string (comma- or newline-separated) into clean addresses. */
function parseBccList(raw: string): string[] {
  return raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
}

// ── Public endpoints (no auth required) ──────────────────────────────────────

// GET /api/admin/public/delivery-mode
adminRouter.get("/public/delivery-mode", async (_req: Request, res: Response) => {
  const raw = await getSetting("delivery_mode") ?? "download";
  res.json({ mode: raw === "mail-only" ? "mail-only" : "download" });
});

// GET /api/admin/public/theme
adminRouter.get("/public/theme", async (_req: Request, res: Response) => {
  res.json({
    primary:        await getSetting("theme_primary")         ?? "#2563eb",
    sidebarBg:      await getSetting("theme_sidebar_bg")      ?? "#1e2235",
    sidebarText:    await getSetting("theme_sidebar_text")    ?? "#94a3b8",
    accent:         await getSetting("theme_accent")          ?? "#f59e0b",
    colorblindMode: (await getSetting("theme_colorblind_mode")) === "true",
  });
});

// GET /api/public/branding
adminRouter.get("/public/branding", async (_req: Request, res: Response) => {
  const raw  = await getSetting("branding_logo_base64")  ?? "";
  const mime = await getSetting("branding_logo_mimetype") ?? "image/png";
  res.json({
    logoSrc:    raw ? `data:${mime};base64,${raw}` : "",
    footerText: await getSetting("branding_footer_text") ?? "IndustryStock.com",
    footerUrl:  await getSetting("branding_footer_url")  ?? "https://www.industrystock.com",
  });
});

// GET /api/public/contact
adminRouter.get("/public/contact", async (_req: Request, res: Response) => {
  const raw  = await getSetting("contact_photo_base64")  ?? "";
  const mime = await getSetting("contact_photo_mimetype") ?? "image/jpeg";
  res.json({
    name:       await getSetting("contact_name")        ?? "Silvio Haase",
    title:      await getSetting("contact_title")       ?? "CMO & Head of Business Development",
    company:    await getSetting("contact_company")     ?? "Deutscher Medien Verlag GmbH / IndustryStock.com",
    email:      await getSetting("contact_email")       ?? "Silvio.Haase@IndustryStock.com",
    photoSrc:   raw ? `data:${mime};base64,${raw}` : "",
    ctaText:    await getSetting("contact_cta_text")    ?? "",
    ctaSubtext: await getSetting("contact_cta_subtext") ?? "",
  });
});

// POST /api/admin/public/send-report
adminRouter.post("/public/send-report", async (req: Request, res: Response) => {
  const {
    recipientEmail, reportType, htmlContent, pdfBase64, filename,
    domain, companyName, gaioScore, scoresJson, pagesCrawled,
  } = req.body as Record<string, unknown>;

  if (!recipientEmail || typeof recipientEmail !== "string") {
    res.status(400).json({ error: "recipientEmail fehlt" }); return;
  }
  const rt = String(reportType ?? "");
  if (rt !== "html" && rt !== "pdf") {
    res.status(400).json({ error: "reportType muss 'html' oder 'pdf' sein" }); return;
  }
  if (rt === "pdf" && (!pdfBase64 || typeof pdfBase64 !== "string")) {
    res.status(400).json({ error: "pdfBase64 fehlt für Typ 'pdf'" }); return;
  }

  const domainStr  = String(domain ?? "unknown");
  const bccList    = parseBccList(await getSetting("delivery_bcc") ?? "");
  const today      = new Date().toLocaleDateString("de-DE");
  const safeBase   = domainStr.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);

  let logId: number;
  try {
    const r = await query<{ id: number }>(
      `INSERT INTO analysis_log
         (domain, company_name, gaio_score, scores_json, pages_crawled,
          status, triggered_by, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, 'completed', 'mail-delivery', NOW(), NOW())
       RETURNING id`,
      [
        domainStr,
        companyName ? String(companyName) : null,
        typeof gaioScore === "number" ? gaioScore : null,
        scoresJson ? String(scoresJson) : null,
        typeof pagesCrawled === "number" ? pagesCrawled : null,
      ],
    );
    logId = r.rows[0].id;

    if (htmlContent && typeof htmlContent === "string") {
      await saveAnalysisExport(logId, htmlContent);
    }
  } catch (err) {
    logger.error({ err }, "send-report: failed to create log entry");
    res.status(500).json({ error: "Fehler beim Erstellen des Eintrags" }); return;
  }

  const attachments: MailOptions["attachments"] = [];

  if (rt === "pdf" && pdfBase64) {
    const pdfBuffer  = Buffer.from(String(pdfBase64), "base64");
    const pdfFile    = filename ? String(filename) : `GAIO-Report-${safeBase}.pdf`;
    attachments.push({ filename: pdfFile, content: pdfBuffer, contentType: "application/pdf" });
  }

  if (htmlContent && typeof htmlContent === "string") {
    const htmlFile = (filename && String(filename).endsWith(".html"))
      ? String(filename)
      : `GAIO-Report-${safeBase}.html`;
    attachments.push({ filename: htmlFile, content: htmlContent, contentType: "text/html" });
  }

  const result = await sendMail({
    to:      String(recipientEmail),
    subject: `GAIO Analyse-Report – ${domainStr}`,
    html:    `<p>Anbei finden Sie den angeforderten GAIO Analyse-Report für <strong>${domainStr}</strong> vom ${today}.</p>`,
    text:    `Anbei finden Sie den angeforderten GAIO Analyse-Report für ${domainStr} vom ${today}.`,
    bcc:     bccList.length > 0 ? bccList.join(", ") : undefined,
    attachments,
  });

  res.json({ ...result, logId });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

adminRouter.post("/login", loginLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) { res.status(400).json({ error: "Benutzername und Passwort erforderlich" }); return; }

  const userResult = await query<DbUser>("SELECT * FROM users WHERE username = $1", [username]);
  const user = userResult.rows[0];
  if (!user) { res.status(401).json({ error: "Ungültige Anmeldedaten" }); return; }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) { res.status(401).json({ error: "Ungültige Anmeldedaten" }); return; }

  await query("UPDATE users SET last_login = NOW() WHERE id = $1", [user.id]);

  if (user.must_change_pw === 1) {
    res.json({ mustChangePw: true, user: safeUser(user) });
    return;
  }

  if (user.is_active === 0) {
    await query("UPDATE users SET is_active = 1 WHERE id = $1", [user.id]);
  }

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  res.cookie("gaio_admin_token", token, COOKIE_OPTS);
  const freshResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [user.id]);
  res.json({ user: safeUser(freshResult.rows[0]) });
});

adminRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("gaio_admin_token", { path: "/" });
  res.json({ ok: true });
});

adminRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  const result = await query<DbUser>("SELECT * FROM users WHERE id = $1", [req.adminUser!.id]);
  const user = result.rows[0];
  if (!user) { res.status(404).json({ error: "Benutzer nicht gefunden" }); return; }
  res.json({ user: safeUser(user) });
});

// ── First-login password change ───────────────────────────────────────────────

adminRouter.post("/set-initial-password", async (req: Request, res: Response) => {
  const { username, tempPassword, newPassword, confirmPassword } = req.body ?? {};
  if (!username || !tempPassword || !newPassword || !confirmPassword) {
    res.status(400).json({ error: "Alle Felder sind erforderlich" }); return;
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: "Passwörter stimmen nicht überein" }); return;
  }

  const userResult = await query<DbUser>("SELECT * FROM users WHERE username = $1", [username]);
  const user = userResult.rows[0];
  if (!user || user.must_change_pw !== 1) {
    res.status(400).json({ error: "Ungültige Anfrage" }); return;
  }

  const valid = await bcrypt.compare(tempPassword, user.password_hash);
  if (!valid) { res.status(401).json({ error: "Temporäres Passwort ist falsch" }); return; }

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.valid) { res.status(400).json({ error: "Passwortrichtlinie nicht erfüllt", details: policy.errors }); return; }

  const hash = await bcrypt.hash(newPassword, 12);
  await query(
    "UPDATE users SET password_hash = $1, must_change_pw = 0, is_active = 1, last_login = NOW() WHERE id = $2",
    [hash, user.id],
  );

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  res.cookie("gaio_admin_token", token, COOKIE_OPTS);
  const freshResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [user.id]);
  res.json({ user: safeUser(freshResult.rows[0]) });
});

// ── User management (admin only) ──────────────────────────────────────────────

adminRouter.get("/users", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const users = (await query<DbUser>("SELECT * FROM users ORDER BY created_at DESC")).rows;
  res.json({ users: users.map(safeUser) });
});

adminRouter.post("/users", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { firstName, lastName, email } = req.body ?? {};
  if (!firstName || !lastName || !email) {
    res.status(400).json({ error: "Vor- und Nachname sowie E-Mail sind erforderlich" }); return;
  }

  const base = (firstName[0] + lastName).replace(/[^a-zA-Z0-9]/g, "");
  let username = base;
  let n = 1;
  while ((await query("SELECT id FROM users WHERE username = $1", [username])).rows[0]) {
    username = base + n++;
  }

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);
  await query(
    `INSERT INTO users (email, username, password_hash, first_name, last_name, role, is_active, must_change_pw, created_by)
     VALUES ($1, $2, $3, $4, $5, 'user', 0, 1, $6)`,
    [email, username, hash, firstName, lastName, req.adminUser!.id],
  );

  const newUserResult = await query<DbUser>("SELECT * FROM users WHERE username = $1", [username]);
  const newUser = newUserResult.rows[0];
  logger.info({ actor: req.adminUser!.username, action: "user_created", target: username }, "Admin created user");

  await sendEmail({
    to: email,
    subject: "Ihr Zugang zum GAIO Analyzer",
    text: `Guten Tag ${firstName} ${lastName},\n\nIhr Zugang zum GAIO Analyzer wurde eingerichtet.\n\nBenutzername: ${username}\nTemporäres Passwort: ${tempPassword}\n\nBitte melden Sie sich an und ändern Sie Ihr Passwort beim ersten Login.\n\nDas temporäre Passwort ist 48 Stunden gültig.`,
  });

  res.status(201).json({ user: safeUser(newUser) });
});

adminRouter.patch("/users/:id/role", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const targetId = parseInt(String(req.params.id), 10);
  const { role } = req.body ?? {};

  if (!["admin", "user_extended", "user"].includes(role)) {
    res.status(400).json({ error: "Ungültige Rolle" }); return;
  }

  const targetResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [targetId]);
  const target = targetResult.rows[0];
  if (!target) { res.status(404).json({ error: "Benutzer nicht gefunden" }); return; }

  if (role === "admin" && target.is_active === 0) {
    res.status(400).json({ error: "Rolle 'admin' kann nur aktiven Benutzern zugewiesen werden" }); return;
  }

  if (targetId === req.adminUser!.id && role !== "admin") {
    const countResult = await query<{ c: string }>(
      "SELECT COUNT(*)::int as c FROM users WHERE role = 'admin'",
    );
    const adminCount = parseInt(String(countResult.rows[0].c), 10);
    if (adminCount <= 1) {
      res.status(400).json({ error: "Sie sind der einzige Admin und können sich nicht selbst degradieren" }); return;
    }
  }

  await query("UPDATE users SET role = $1 WHERE id = $2", [role, targetId]);
  logger.info({ actor: req.adminUser!.username, action: "role_changed", target: target.username, newRole: role }, "Admin changed role");

  const updatedResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [targetId]);
  res.json({ user: safeUser(updatedResult.rows[0]) });
});

adminRouter.delete("/users/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const targetId = parseInt(String(req.params.id), 10);
  if (targetId === req.adminUser!.id) {
    res.status(400).json({ error: "Sie können sich nicht selbst löschen" }); return;
  }

  const targetResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [targetId]);
  const target = targetResult.rows[0];
  if (!target) { res.status(404).json({ error: "Benutzer nicht gefunden" }); return; }

  await query("DELETE FROM verification_codes WHERE user_id = $1", [targetId]);
  await query("DELETE FROM users WHERE id = $1", [targetId]);
  logger.info({ actor: req.adminUser!.username, action: "user_deleted", target: target.username }, "Admin deleted user");

  res.json({ ok: true });
});

// ── Profile ───────────────────────────────────────────────────────────────────

adminRouter.get("/profile", requireAuth, async (req: Request, res: Response) => {
  const result = await query<DbUser>("SELECT * FROM users WHERE id = $1", [req.adminUser!.id]);
  const user = result.rows[0];
  if (!user) { res.status(404).json({ error: "Benutzer nicht gefunden" }); return; }
  res.json({ user: safeUser(user) });
});

adminRouter.patch("/profile", requireAuth, async (req: Request, res: Response) => {
  const { firstName, lastName, newUsername, newEmail, currentPassword, newPassword } = req.body ?? {};
  const userId = req.adminUser!.id;

  let userResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [userId]);
  let user = userResult.rows[0];

  if (firstName || lastName) {
    const fn = firstName?.trim() || user.first_name;
    const ln = lastName?.trim() || user.last_name;
    await query("UPDATE users SET first_name = $1, last_name = $2 WHERE id = $3", [fn, ln, userId]);
    await sendEmail({ to: user.email, subject: "Ihre Daten wurden geändert – GAIO Analyzer", text: `Ihr Name wurde aktualisiert auf: ${fn} ${ln}` });
    userResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [userId]);
    user = userResult.rows[0];
  }

  if (newUsername) {
    if (!currentPassword) { res.status(400).json({ error: "Aktuelles Passwort für Benutzernamensänderung erforderlich" }); return; }
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) { res.status(401).json({ error: "Aktuelles Passwort ist falsch" }); return; }
    if ((await query("SELECT id FROM users WHERE username = $1 AND id != $2", [newUsername, userId])).rows[0]) {
      res.status(400).json({ error: "Benutzername bereits vergeben" }); return;
    }
    await query("UPDATE users SET username = $1 WHERE id = $2", [newUsername, userId]);
    const freshResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [userId]);
    const freshUser = freshResult.rows[0];
    const token = signToken({ userId, username: newUsername, role: freshUser.role });
    res.cookie("gaio_admin_token", token, COOKIE_OPTS);
    user = freshUser;
  }

  if (newPassword) {
    if (!currentPassword) { res.status(400).json({ error: "Aktuelles Passwort erforderlich" }); return; }
    const freshResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [userId]);
    const freshUser = freshResult.rows[0];
    const valid = await bcrypt.compare(currentPassword, freshUser.password_hash);
    if (!valid) { res.status(401).json({ error: "Aktuelles Passwort ist falsch" }); return; }
    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) { res.status(400).json({ error: "Passwortrichtlinie nicht erfüllt", details: policy.errors }); return; }
    const hash = await bcrypt.hash(newPassword, 12);
    await query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, userId]);
    await sendEmail({ to: user.email, subject: "Ihr Passwort wurde geändert – GAIO Analyzer", text: "Ihr Passwort wurde erfolgreich geändert. Falls Sie diese Änderung nicht beantragt haben, kontaktieren Sie uns sofort." });
    userResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [userId]);
    user = userResult.rows[0];
  }

  if (newEmail) {
    if ((await query("SELECT id FROM users WHERE email = $1 AND id != $2", [newEmail, userId])).rows[0]) {
      res.status(400).json({ error: "E-Mail bereits vergeben" }); return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await query(
      "INSERT INTO verification_codes (user_id, code, purpose, new_value, expires_at) VALUES ($1, $2, 'email_change', $3, $4)",
      [userId, code, newEmail, expiresAt],
    );
    await sendEmail({
      to: user.email,
      subject: "Ihr Bestätigungscode – GAIO Analyzer",
      text: `Ihr Bestätigungscode lautet:\n\n${code}\n\nDieser Code ist 15 Minuten gültig.\nFalls Sie diese Änderung nicht beantragt haben, ignorieren Sie diese E-Mail.`,
    });
    res.json({ requiresVerification: true, code }); return;
  }

  const updatedResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [userId]);
  res.json({ user: safeUser(updatedResult.rows[0]) });
});

adminRouter.post("/verify-code", requireAuth, async (req: Request, res: Response) => {
  const { code, purpose } = req.body ?? {};
  const userId = req.adminUser!.id;

  const recordResult = await query<{ id: number; new_value: string | null }>(`
    SELECT id, new_value FROM verification_codes
    WHERE user_id = $1 AND code = $2 AND purpose = $3 AND used = 0 AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC LIMIT 1
  `, [userId, code, purpose]);
  const record = recordResult.rows[0];

  if (!record) { res.status(400).json({ error: "Ungültiger oder abgelaufener Code" }); return; }

  await query("UPDATE verification_codes SET used = 1 WHERE id = $1", [record.id]);

  if (purpose === "email_change" && record.new_value) {
    await query("UPDATE users SET email = $1 WHERE id = $2", [record.new_value, userId]);
  }

  const updatedResult = await query<DbUser>("SELECT * FROM users WHERE id = $1", [userId]);
  res.json({ user: safeUser(updatedResult.rows[0]) });
});

// ── Analysis log ──────────────────────────────────────────────────────────────

interface AnalysisLogRow {
  id: number;
  analysis_uuid: string | null;
  domain: string;
  company_name: string | null;
  triggered_by: string | null;
  gaio_score: number | null;
  scores_json: string | null;
  pages_crawled: number | null;
  status: string;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  html_export_id: number | null;
}

// POST /api/admin/analysis-log/auto-export — NO auth, called automatically on analysis completion
adminRouter.post("/analysis-log/auto-export", async (req: Request, res: Response) => {
  const { htmlContent, logId, domain, companyName, gaioScore, scoresJson, pagesCrawled } = req.body ?? {};

  if (!htmlContent || typeof htmlContent !== "string") {
    res.status(400).json({ error: "htmlContent fehlt" }); return;
  }

  const domainStr = String(domain ?? "");
  let exportId: number;
  let targetLogId: number;
  let isFreshExport = false;

  async function insertAutoLogEntry(): Promise<number> {
    const r = await query<{ id: number }>(
      `INSERT INTO analysis_log
         (domain, company_name, gaio_score, scores_json, pages_crawled,
          status, triggered_by, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, 'completed', 'auto', NOW(), NOW())
       RETURNING id`,
      [
        String(domain ?? ""),
        companyName ? String(companyName) : null,
        typeof gaioScore === "number" ? gaioScore : null,
        scoresJson ? String(scoresJson) : null,
        typeof pagesCrawled === "number" ? pagesCrawled : null,
      ],
    );
    return r.rows[0].id;
  }

  try {
    if (logId && typeof logId === "number") {
      const existingResult = await query<{ id: number; html_export_id: number | null }>(
        "SELECT id, html_export_id FROM analysis_log WHERE id = $1",
        [logId],
      );
      const existing = existingResult.rows[0];

      if (existing) {
        targetLogId = existing.id;
        if (existing.html_export_id) {
          res.json({ exportId: existing.html_export_id, logId: targetLogId, skipped: true }); return;
        }
        exportId = await saveAnalysisExport(targetLogId, htmlContent);
        isFreshExport = true;
        res.json({ exportId, logId: targetLogId });
      } else {
        targetLogId = await insertAutoLogEntry();
        exportId = await saveAnalysisExport(targetLogId, htmlContent);
        isFreshExport = true;
        res.json({ exportId, logId: targetLogId });
      }
    } else {
      const recentResult = await query<{ id: number; html_export_id: number | null }>(
        `SELECT id, html_export_id FROM analysis_log
         WHERE domain = $1 AND status = 'completed'
         AND completed_at > NOW() - INTERVAL '5 minutes'
         LIMIT 1`,
        [domainStr],
      );
      const recent = recentResult.rows[0];

      if (recent) {
        targetLogId = recent.id;
        if (!recent.html_export_id) {
          exportId = await saveAnalysisExport(targetLogId, htmlContent);
        } else {
          exportId = recent.html_export_id;
        }
        res.json({ exportId, logId: targetLogId, duplicate: true }); return;
      }

      targetLogId = await insertAutoLogEntry();
      exportId = await saveAnalysisExport(targetLogId, htmlContent);
      isFreshExport = true;
      res.json({ exportId, logId: targetLogId });
    }
  } catch (err) {
    logger.error({ err }, "Failed to save auto-export");
    res.status(500).json({ error: "Fehler beim Speichern" }); return;
  }

  // BCC copy: only for fresh (non-duplicate) exports
  if (isFreshExport) {
    const bccList = parseBccList(await getSetting("delivery_bcc") ?? "");
    if (bccList.length > 0) {
      const today    = new Date().toLocaleDateString("de-DE");
      const safeBase = domainStr.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);
      sendMail({
        to:      bccList.join(", "),
        subject: `[BCC] GAIO Analyse-Report – ${domainStr} (${today})`,
        html:    `<p>Automatische Kopie: GAIO Analyse-Report für <strong>${domainStr}</strong> vom ${today}.</p>`,
        text:    `Automatische Kopie: GAIO Analyse-Report für ${domainStr} vom ${today}.`,
        attachments: [{ filename: `GAIO-Report-${safeBase}.html`, content: htmlContent, contentType: "text/html" }],
      }).catch((err: unknown) => logger.warn({ err }, "auto-export BCC send failed"));
    }
  }
});

// POST /api/admin/analysis-log/:id/export — NO auth
adminRouter.post("/analysis-log/:id/export", async (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.id), 10);
  if (isNaN(logId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

  const { htmlContent } = req.body ?? {};
  if (!htmlContent || typeof htmlContent !== "string") {
    res.status(400).json({ error: "htmlContent fehlt" }); return;
  }

  const entry = (await query<{ id: number }>("SELECT id FROM analysis_log WHERE id = $1", [logId])).rows[0];
  if (!entry) {
    res.status(404).json({ error: "Analyseeintrag nicht gefunden" }); return;
  }

  try {
    const exportId = await saveAnalysisExport(logId, htmlContent);
    res.json({ exportId });
  } catch (err) {
    logger.error({ err }, "Failed to save analysis export");
    res.status(500).json({ error: "Export konnte nicht gespeichert werden" });
  }
});

// GET /api/admin/analysis-log — admin only, paginated
adminRouter.get("/analysis-log", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const page   = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const offset = (page - 1) * limit;
  const statusParam = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
  const searchParam = typeof req.query.search === "string" && req.query.search ? `%${req.query.search}%` : null;

  const totalResult = await query<{ c: string }>(`
    SELECT COUNT(*)::int as c FROM analysis_log al
    WHERE ($1::text IS NULL OR al.status = $1)
      AND ($2::text IS NULL OR al.domain LIKE $2 OR al.company_name LIKE $2)
  `, [statusParam, searchParam]);
  const total = parseInt(String(totalResult.rows[0].c), 10);

  const rows = (await query<AnalysisLogRow & { has_html_export: number }>(`
    SELECT al.*,
       CASE WHEN ae.id IS NOT NULL THEN 1 ELSE 0 END as has_html_export
     FROM analysis_log al
     LEFT JOIN analysis_exports ae ON ae.id = al.html_export_id
     WHERE ($1::text IS NULL OR al.status = $1)
       AND ($2::text IS NULL OR al.domain LIKE $2 OR al.company_name LIKE $2)
     ORDER BY al.started_at DESC
     LIMIT $3 OFFSET $4
  `, [statusParam, searchParam, limit, offset])).rows;

  const storageResult = await query<{ total_kb: string }>(
    "SELECT COALESCE(SUM(LENGTH(html_content)) / 1024, 0)::int as total_kb FROM analysis_exports",
  );
  const storageTotalKb = parseInt(String(storageResult.rows[0].total_kb ?? "0"), 10);

  const items = rows.map(r => ({
    id: r.id,
    domain: r.domain,
    companyName: r.company_name,
    triggeredBy: r.triggered_by,
    gaioScore: r.gaio_score,
    scoresJson: r.scores_json,
    pagesCrawled: r.pages_crawled,
    status: r.status,
    errorMessage: r.error_message,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    hasHtmlExport: r.has_html_export === 1,
  }));

  res.json({ items, total, page, pages: Math.ceil(total / limit), storageTotalKb });
});

// GET /api/admin/analysis-log/:id/export — admin only
adminRouter.get("/analysis-log/:id/export", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.id), 10);
  if (isNaN(logId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

  const result = await query<{ html_content: string; domain: string; started_at: string }>(
    "SELECT ae.html_content, al.domain, al.started_at FROM analysis_exports ae JOIN analysis_log al ON al.id = ae.analysis_id WHERE al.id = $1",
    [logId],
  );
  const row = result.rows[0];

  if (!row) { res.status(404).json({ error: "Kein HTML-Export vorhanden" }); return; }

  const date = String(row.started_at).slice(0, 10).replace(/-/g, "");
  const safeDomain = row.domain.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);
  const filename = `GAIO-${safeDomain}-${date}.html`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(row.html_content);
});

// DELETE /api/admin/analysis-log/:id — admin only
adminRouter.delete("/analysis-log/:id", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.id), 10);
  if (isNaN(logId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

  const entry = (await query<{ id: number }>("SELECT id FROM analysis_log WHERE id = $1", [logId])).rows[0];
  if (!entry) { res.status(404).json({ error: "Eintrag nicht gefunden" }); return; }

  try {
    await query("DELETE FROM analysis_exports WHERE analysis_id = $1", [logId]);
    await query("DELETE FROM analysis_log WHERE id = $1", [logId]);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete analysis log entry");
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// POST /api/admin/angebot/generate — admin only
adminRouter.post("/angebot/generate", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  interface UploadRec { finding: string; fix: string; }
  interface UploadBody {
    fromUpload: true;
    domain: string;
    companyName?: string;
    exportDate?: string;
    gaioScore: number;
    scores: Record<string, number | null>;
    recommendations: {
      kritisch:    UploadRec[];
      hoherHebel:  UploadRec[];
      nachgeordnet: UploadRec[];
    };
  }
  interface ProtocolBody { analysisId?: unknown; fromUpload?: false; }
  const body = req.body as UploadBody | ProtocolBody;

  let domain: string;
  let companyName: string | null;
  let exportDate: string | null;
  let gaioScore: number | null;
  let scores: Record<string, number | null>;
  let kritisch:    { finding: string; fix: string }[];
  let hoherHebel:  { finding: string; fix: string }[];
  let nachgeordnet:{ finding: string; fix: string }[];

  if (body.fromUpload === true) {
    const ub = body as UploadBody;
    if (!ub.domain || ub.gaioScore === undefined || !ub.scores) {
      res.status(400).json({ error: "Unvollständige Upload-Daten" }); return;
    }
    domain      = ub.domain;
    companyName = ub.companyName ?? null;
    exportDate  = ub.exportDate ?? null;
    gaioScore   = ub.gaioScore;
    scores      = ub.scores;
    kritisch    = ub.recommendations?.kritisch    ?? [];
    hoherHebel  = ub.recommendations?.hoherHebel  ?? [];
    nachgeordnet = ub.recommendations?.nachgeordnet ?? [];
  } else {
    const pb = body as ProtocolBody;
    const id = typeof pb.analysisId === "number" ? pb.analysisId : parseInt(String(pb.analysisId ?? ""), 10);
    if (!id || isNaN(id)) { res.status(400).json({ error: "analysisId fehlt" }); return; }

    type LogRow = {
      id: number; domain: string; company_name: string | null; gaio_score: number | null;
      completed_at: string | null; scores_json: string | null; html_export_id: number | null;
    };
    const logResult = await query<LogRow>(
      "SELECT id, domain, company_name, gaio_score, completed_at, scores_json, html_export_id FROM analysis_log WHERE id = $1",
      [id],
    );
    const log = logResult.rows[0];
    if (!log) { res.status(404).json({ error: "Analyse nicht gefunden" }); return; }

    let htmlContent = "";
    if (log.html_export_id) {
      const expResult = await query<{ html_content: string }>(
        "SELECT html_content FROM analysis_exports WHERE id = $1",
        [log.html_export_id],
      );
      if (expResult.rows[0]) htmlContent = expResult.rows[0].html_content;
    }

    domain      = log.domain;
    companyName = log.company_name;
    exportDate  = log.completed_at;
    gaioScore   = log.gaio_score;
    scores      = {};
    try { scores = JSON.parse(log.scores_json ?? "{}") as Record<string, number | null>; } catch { /* ignore */ }

    kritisch    = [];
    hoherHebel  = [];
    nachgeordnet = [];

    if (htmlContent) {
      const $ = cheerioLoad(htmlContent);
      $(".rec").each((_i, el) => {
        const style   = $(el).attr("style") ?? "";
        const finding = $(el).find(".finding").first().text().trim();
        const fix     = $(el).find(".fix").first().text().trim();
        if (!finding && !fix) return;
        if      (style.includes("#ef4444")) kritisch.push({ finding, fix });
        else if (style.includes("#f59e0b")) hoherHebel.push({ finding, fix });
        else                                nachgeordnet.push({ finding, fix });
      });
    }
  }

  const sc = (k: string) => { const v = scores[k]; return (v !== undefined && v !== null) ? String(Math.round(v)) : "–"; };
  const fmtNamed = (arr: { finding: string; fix: string }[], prefix: string) =>
    arr.length
      ? arr.map((r, i) => `${prefix}${i + 1}: ${r.finding} → ${r.fix}`).join("\n")
      : "– keine –";

  const angebotTemplate = await getPrompt("angebot-creator");
  const prompt = fillTemplate(angebotTemplate, {
    COMPANY_NAME: companyName ?? domain,
    DOMAIN: domain,
    EXPORT_DATE: exportDate ? String(exportDate).slice(0, 10) : "–",
    GAIO_SCORE: gaioScore !== null ? String(gaioScore) : "–",
    TECH_SEO: sc("technicalSeo"),
    SCHEMA_ORG: sc("schemaOrg"),
    HEADINGS: sc("headingStructure"),
    CONTENT: sc("contentRelevance"),
    FAQ_SCORE: sc("faqQuality"),
    LLM: sc("llmDiscoverability"),
    MASSNAHMEN_KRITISCH: fmtNamed(kritisch, "K"),
    MASSNAHMEN_HOHER_HEBEL: fmtNamed(hoherHebel, "H"),
    MASSNAHMEN_NACHGEORDNET: fmtNamed(nachgeordnet, "N"),
  });

  try {
    const rawHtml = await callLLM(prompt, 6000);
    let html = rawHtml.trim();
    html = html.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/, "");
    html = html.replace(/<hr\s*\/?>/gi, "<hr><br>");
    html = html.replace(/☐/g, "[ ]");
    html = html.replace(/&#9744;/g, "[ ]");
    html = html.replace(/\u2610/g, "[ ]");
    html = html.trim();
    res.json({ html, companyName: companyName ?? domain, domain });
  } catch (err) {
    logger.error({ err }, "Angebot generation failed");
    res.status(500).json({ error: "KI-Generierung fehlgeschlagen" });
  }
});

// ── Settings helpers ──────────────────────────────────────────────────────────

const SETTINGS_GROUPS: Record<string, string[]> = {
  ai:       ["ai_provider","ai_model_claude","ai_api_key_claude","ai_model_openai","ai_api_key_openai","ai_api_key_perplexity","ai_model_perplexity","ai_api_key_gemini","ai_model_gemini","ai_custom_providers"],
  mail:     ["mail_host","mail_port","mail_secure","mail_user","mail_password","mail_from_name","mail_from_address"],
  delivery: ["delivery_mode","delivery_bcc","delivery_require_email"],
};

const SECRET_KEYS = new Set(["ai_api_key_claude","ai_api_key_openai","ai_api_key_perplexity","ai_api_key_gemini","mail_password"]);

function maskSecret(value: string): string {
  if (!value) return "";
  return "••••••••" + value.slice(-4);
}

function isPlaceholder(value: string): boolean {
  return value.includes("••••••••");
}

function buildDataUrl(raw: string, mime: string): string {
  return raw ? `data:${mime};base64,${raw}` : "";
}

function stripDataUrl(value: string): { raw: string; mime: string } {
  if (value.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.+)$/s.exec(value);
    if (m) return { raw: m[2], mime: m[1] };
    return { raw: "", mime: "" };
  }
  return { raw: value, mime: "" };
}

const MAX_B64_CHARS = Math.ceil(500 * 1024 * (4 / 3));

// GET /api/admin/settings/theme
adminRouter.get("/settings/theme", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  res.json({
    theme_primary:         await getSetting("theme_primary")         ?? "#2563eb",
    theme_sidebar_bg:      await getSetting("theme_sidebar_bg")      ?? "#1e2235",
    theme_sidebar_text:    await getSetting("theme_sidebar_text")    ?? "#94a3b8",
    theme_accent:          await getSetting("theme_accent")          ?? "#f59e0b",
    theme_colorblind_mode: await getSetting("theme_colorblind_mode") ?? "false",
  });
});

// GET /api/admin/settings/branding
adminRouter.get("/settings/branding", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  res.json({
    branding_logo_base64:   buildDataUrl(await getSetting("branding_logo_base64") ?? "", await getSetting("branding_logo_mimetype") ?? "image/png"),
    branding_logo_mimetype: await getSetting("branding_logo_mimetype") ?? "image/png",
    branding_footer_text:   await getSetting("branding_footer_text")   ?? "IndustryStock.com",
    branding_footer_url:    await getSetting("branding_footer_url")    ?? "https://www.industrystock.com",
  });
});

// PATCH /api/admin/settings/branding
adminRouter.patch("/settings/branding", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const body = req.body as Record<string, string>;
  if ("branding_logo_base64" in body) {
    const { raw, mime } = stripDataUrl(String(body.branding_logo_base64 ?? ""));
    if (raw && raw.length > MAX_B64_CHARS) {
      res.status(413).json({ error: "Logo zu groß. Maximal 500 KB erlaubt." }); return;
    }
    await setSetting("branding_logo_base64", raw);
    if (mime) await setSetting("branding_logo_mimetype", mime);
  }
  if ("branding_logo_mimetype" in body && body.branding_logo_mimetype) {
    await setSetting("branding_logo_mimetype", String(body.branding_logo_mimetype));
  }
  if ("branding_footer_text" in body) await setSetting("branding_footer_text", String(body.branding_footer_text ?? ""));
  if ("branding_footer_url" in body)  await setSetting("branding_footer_url",  String(body.branding_footer_url  ?? ""));
  const THEME_KEYS = ["theme_primary", "theme_sidebar_bg", "theme_sidebar_text", "theme_accent", "theme_colorblind_mode"] as const;
  for (const k of THEME_KEYS) {
    if (k in body) await setSetting(k, String((body as Record<string, string>)[k] ?? ""));
  }
  res.json({ success: true });
});

// GET /api/admin/settings/contact
adminRouter.get("/settings/contact", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  res.json({
    contact_name:           await getSetting("contact_name")           ?? "Silvio Haase",
    contact_title:          await getSetting("contact_title")          ?? "CMO & Head of Business Development",
    contact_company:        await getSetting("contact_company")        ?? "Deutscher Medien Verlag GmbH / IndustryStock.com",
    contact_email:          await getSetting("contact_email")          ?? "Silvio.Haase@IndustryStock.com",
    contact_photo_base64:   buildDataUrl(await getSetting("contact_photo_base64") ?? "", await getSetting("contact_photo_mimetype") ?? "image/jpeg"),
    contact_photo_mimetype: await getSetting("contact_photo_mimetype") ?? "image/jpeg",
    contact_cta_text:       await getSetting("contact_cta_text")       ?? "",
    contact_cta_subtext:    await getSetting("contact_cta_subtext")    ?? "",
  });
});

// PATCH /api/admin/settings/contact
adminRouter.patch("/settings/contact", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const body = req.body as Record<string, string>;
  const textFields = ["contact_name","contact_title","contact_company","contact_email","contact_cta_text","contact_cta_subtext"] as const;
  for (const f of textFields) {
    if (f in body) await setSetting(f, String(body[f] ?? ""));
  }
  if ("contact_photo_base64" in body) {
    const { raw, mime } = stripDataUrl(String(body.contact_photo_base64 ?? ""));
    if (raw && raw.length > MAX_B64_CHARS) {
      res.status(413).json({ error: "Foto zu groß. Maximal 500 KB erlaubt." }); return;
    }
    await setSetting("contact_photo_base64", raw);
    if (mime) await setSetting("contact_photo_mimetype", mime);
  }
  if ("contact_photo_mimetype" in body && body.contact_photo_mimetype) {
    await setSetting("contact_photo_mimetype", String(body.contact_photo_mimetype));
  }
  res.json({ success: true });
});

// GET /api/admin/settings/permissions
adminRouter.get("/settings/permissions", requireAuth, async (_req: Request, res: Response) => {
  const raw = await getSetting("permissions_json") ?? "{}";
  try { res.json(JSON.parse(raw)); } catch { res.json({}); }
});

// PATCH /api/admin/settings/permissions
adminRouter.patch("/settings/permissions", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    await setSetting("permissions_json", JSON.stringify(req.body));
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Ungültige Berechtigungen" });
  }
});

// GET /api/admin/settings/ai-status
adminRouter.get("/settings/ai-status", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const provider = await getSetting("ai_provider") ?? "claude";
  const hasApiKey = {
    claude:     (await getSetting("ai_api_key_claude")     ?? "") !== "",
    openai:     (await getSetting("ai_api_key_openai")     ?? "") !== "",
    perplexity: (await getSetting("ai_api_key_perplexity") ?? "") !== "",
    gemini:     (await getSetting("ai_api_key_gemini")     ?? "") !== "",
  };
  const lastRow = (await query<{ completed_at: string }>(
    "SELECT completed_at FROM analysis_log WHERE status='completed' ORDER BY completed_at DESC LIMIT 1",
  )).rows[0];
  res.json({ provider, hasApiKey, lastCompletedAt: lastRow?.completed_at ?? null });
});

// POST /api/admin/settings/test-mail
adminRouter.post("/settings/test-mail", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const userResult = await query<{ email: string }>("SELECT email FROM users WHERE id = $1", [req.adminUser!.id]);
  const to = userResult.rows[0]?.email ?? await getSetting("mail_from_address") ?? "";
  if (!to) { res.status(400).json({ success: false, error: "Keine E-Mail-Adresse gefunden" }); return; }

  const result = await sendMail({
    to,
    subject: "GAIO Analyzer — Mailserver-Test",
    text:    "Der Mailserver ist korrekt konfiguriert.",
  });
  res.json(result);
});

// ── Database settings ─────────────────────────────────────────────────────────

function maskDbUrl(raw: string): string {
  return raw.replace(/:([^@/]+)@/, ":••••••••@");
}

async function testDbConnection(connectionString: string): Promise<{ ok: boolean; ms?: number; error?: string }> {
  const start = Date.now();
  const client = new PgClient({ connectionString, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    try { await client.end(); } catch { /* ignore */ }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// GET /api/admin/settings/database
adminRouter.get("/settings/database", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const envUrl = process.env.DATABASE_URL ?? "";
  let source: "env" | "bootstrap" | "default";
  let rawUrl: string;

  if (envUrl) {
    source = "env";
    rawUrl = envUrl;
  } else {
    const stored = await getSetting("database_url") ?? "";
    if (stored) {
      source = "bootstrap";
      rawUrl = stored;
    } else {
      source = "default";
      rawUrl = "";
    }
  }

  const maskedUrl = rawUrl ? maskDbUrl(rawUrl) : "";
  let connected = false;
  if (rawUrl) {
    const result = await testDbConnection(rawUrl);
    connected = result.ok;
  }

  res.json({ source, maskedUrl, connected });
});

// POST /api/admin/settings/database
adminRouter.post("/settings/database", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { connectionString } = req.body as { connectionString?: string };
  if (!connectionString || typeof connectionString !== "string" || !connectionString.trim()) {
    res.status(400).json({ error: "connectionString fehlt" }); return;
  }
  await setSetting("database_url", connectionString.trim());
  res.json({ success: true });
});

// POST /api/admin/settings/database/test
adminRouter.post("/settings/database/test", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { connectionString } = req.body as { connectionString?: string };
  const rawUrl = connectionString?.trim()
    || process.env.DATABASE_URL
    || await getSetting("database_url")
    || "";

  if (!rawUrl) {
    res.json({ ok: false, error: "Kein Connection String angegeben" }); return;
  }

  const result = await testDbConnection(rawUrl);
  res.json(result);
});

// GET /api/admin/settings/:group
adminRouter.get("/settings/:group", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const group = String(req.params.group);
  const keys = SETTINGS_GROUPS[group];
  if (!keys) { res.status(400).json({ error: "Ungültige Gruppe" }); return; }

  const result: Record<string, string> = {};
  for (const key of keys) {
    const raw = await getSetting(key) ?? "";
    if (key === "ai_custom_providers") {
      try {
        const providers = JSON.parse(raw || "[]") as CustomProviderRecord[];
        result[key] = JSON.stringify(providers.map(p => ({ ...p, api_key: maskSecret(p.api_key) })));
      } catch { result[key] = "[]"; }
    } else {
      result[key] = SECRET_KEYS.has(key) ? maskSecret(raw) : raw;
    }
  }
  res.json(result);
});

// PATCH /api/admin/settings/:group
adminRouter.patch("/settings/:group", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const group = String(req.params.group);
  const keys = SETTINGS_GROUPS[group];
  if (!keys) { res.status(400).json({ error: "Ungültige Gruppe" }); return; }

  const body = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(body)) {
    if (!keys.includes(key)) continue;
    if (key === "ai_custom_providers") {
      try {
        const incoming = JSON.parse(String(value)) as CustomProviderRecord[];
        const stored = JSON.parse(await getSetting("ai_custom_providers") || "[]") as CustomProviderRecord[];
        const merged = incoming.map(p => {
          if (isPlaceholder(p.api_key)) {
            const existing = stored.find(s => s.id === p.id);
            return { ...p, api_key: existing?.api_key ?? "" };
          }
          return p;
        });
        await setSetting(key, JSON.stringify(merged));
      } catch { /* ignore invalid JSON */ }
    } else if (SECRET_KEYS.has(key) && isPlaceholder(String(value))) {
      continue;
    } else {
      await setSetting(key, String(value));
    }
  }
  res.json({ success: true });
});

// POST /api/admin/analysis/:id/send-email
adminRouter.post("/analysis/:id/send-email", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.id), 10);
  if (isNaN(logId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

  const { recipientEmail } = req.body as { recipientEmail?: string };
  if (!recipientEmail) { res.status(400).json({ error: "recipientEmail fehlt" }); return; }

  const exportResult = await query<{ html_content: string }>(
    "SELECT html_content FROM analysis_exports WHERE analysis_id = $1 ORDER BY id DESC LIMIT 1",
    [logId],
  );
  if (!exportResult.rows[0]) { res.status(404).json({ error: "Kein HTML-Export vorhanden" }); return; }

  const logResult = await query<{ domain: string }>("SELECT domain FROM analysis_log WHERE id = $1", [logId]);
  const domain = logResult.rows[0]?.domain ?? "analyse";
  const bccList = parseBccList(await getSetting("delivery_bcc") ?? "");

  const result = await sendMail({
    to:      recipientEmail,
    subject: `GAIO Analyzer Bericht — ${domain}`,
    html:    `<p>Im Anhang finden Sie den GAIO Analyzer Bericht für <strong>${domain}</strong>.</p>`,
    text:    `GAIO Analyzer Bericht für ${domain}`,
    bcc:     bccList.length > 0 ? bccList.join(", ") : undefined,
    attachments: [{
      filename:    `GAIO-${domain.replace(/[^a-z0-9.-]/gi, "_")}.html`,
      content:     exportResult.rows[0].html_content,
      contentType: "text/html",
    }],
  });
  res.json(result);
});

// ── Shares (admin) ────────────────────────────────────────────────────────────

interface SharedAnalysisRow {
  id: number;
  token: string;
  analysis_id: number | null;
  created_by: number | null;
  created_at: string;
  expires_at: string;
  is_active: number;
  title: string | null;
  view_count: number;
}

function buildShareUrl(base: string, token: string): string {
  return base ? `${base}/share/${token}` : `/share/${token}`;
}

// POST /api/admin/shares — create a share link
adminRouter.post("/shares", requireAuth, async (req: Request, res: Response) => {
  const { analysisId, expiryDays, title } = req.body ?? {};
  if (!analysisId || typeof analysisId !== "number") {
    res.status(400).json({ error: "analysisId fehlt" }); return;
  }
  const days = Math.max(1, Math.min(365, Number(expiryDays) || 30));
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const userId = req.adminUser?.id ?? null;

  await query(
    "INSERT INTO shared_analyses (token, analysis_id, created_by, expires_at, title) VALUES ($1, $2, $3, $4, $5)",
    [token, analysisId, userId, expiresAt, title ?? null],
  );

  const base = await getSetting("sharing_base_url") ?? "";
  const shareUrl = buildShareUrl(base.trim(), token);
  res.json({ token, shareUrl, expiresAt });
});

// GET /api/admin/shares — list all shares
adminRouter.get("/shares", requireAuth, async (_req: Request, res: Response) => {
  const rows = (await query<SharedAnalysisRow & { domain: string | null; company_name: string | null }>(`
    SELECT sa.id, sa.token, sa.analysis_id, sa.created_by, sa.created_at,
           sa.expires_at, sa.is_active, sa.title, sa.view_count,
           al.domain, al.company_name
    FROM shared_analyses sa
    LEFT JOIN analysis_log al ON al.id = sa.analysis_id
    ORDER BY sa.created_at DESC
  `)).rows;

  const base = (await getSetting("sharing_base_url") ?? "").trim();
  const items = rows.map((r) => ({
    id: r.id,
    token: r.token,
    analysisId: r.analysis_id,
    domain: r.domain ?? null,
    companyName: r.company_name ?? null,
    title: r.title,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    isActive: r.is_active === 1,
    viewCount: r.view_count,
    shareUrl: buildShareUrl(base, r.token),
  }));
  res.json({ items });
});

// DELETE /api/admin/shares/:id — deactivate a share
adminRouter.delete("/shares/:id", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  await query("UPDATE shared_analyses SET is_active = 0 WHERE id = $1", [id]);
  res.json({ ok: true });
});

// GET /api/admin/shares/:id/access-log
adminRouter.get("/shares/:id/access-log", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Ungültige ID" }); return; }
  const items = (await query<{ id: number; accessed_at: string; ip_hash: string | null; user_agent: string | null }>(`
    SELECT id, accessed_at, ip_hash, user_agent
    FROM share_access_log
    WHERE share_id = $1
    ORDER BY accessed_at DESC
    LIMIT 100
  `, [id])).rows;
  res.json({ items: items.map((r) => ({ id: r.id, accessedAt: r.accessed_at, ipHash: r.ip_hash, userAgent: r.user_agent })) });
});

// ── Prompt-Verwaltung ─────────────────────────────────────────────────────────

adminRouter.get("/prompts", requireAuth, requireAdmin, async (_req, res) => {
  type DbPromptRow = {
    id: number; slug: string; name: string; description: string;
    module: string; is_modified: number; updated_at: string;
  };
  const rows = (await query<DbPromptRow>(
    "SELECT id, slug, name, description, module, is_modified, updated_at FROM prompts ORDER BY module, name",
  )).rows;
  res.json({
    prompts: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      module: r.module,
      isModified: r.is_modified === 1,
      updatedAt: r.updated_at,
    })),
  });
});

adminRouter.get("/prompts/:slug", requireAuth, requireAdmin, async (req, res) => {
  const slug = req.params.slug as string;
  type DbPromptFull = {
    id: number; slug: string; name: string; description: string;
    module: string; template: string; placeholders: string;
    is_modified: number; updated_at: string;
  };
  const row = (await query<DbPromptFull>(
    "SELECT id, slug, name, description, module, template, placeholders, is_modified, updated_at FROM prompts WHERE slug = $1",
    [slug],
  )).rows[0];
  if (!row) { res.status(404).json({ error: "Prompt nicht gefunden" }); return; }
  const def = PROMPT_DEFAULTS_MAP.get(slug);
  res.json({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    module: row.module,
    template: row.template,
    placeholders: JSON.parse(row.placeholders || "[]") as unknown[],
    isModified: row.is_modified === 1,
    updatedAt: row.updated_at,
    defaultTemplate: def?.template ?? row.template,
  });
});

adminRouter.patch("/prompts/:slug", requireAuth, requireAdmin, async (req, res) => {
  const slug = req.params.slug as string;
  const { template } = req.body as { template?: string };
  if (typeof template !== "string" || template.trim().length === 0) {
    res.status(400).json({ error: "template ist erforderlich" }); return;
  }
  const exists = (await query("SELECT id FROM prompts WHERE slug = $1", [slug])).rows[0];
  if (!exists) { res.status(404).json({ error: "Prompt nicht gefunden" }); return; }
  await query(
    "UPDATE prompts SET template = $1, is_modified = 1, updated_at = NOW() WHERE slug = $2",
    [template.trim(), slug],
  );
  clearPromptCache(slug);
  res.json({ ok: true });
});

adminRouter.post("/prompts/:slug/reset", requireAuth, requireAdmin, async (req, res) => {
  const slug = req.params.slug as string;
  const def = PROMPT_DEFAULTS_MAP.get(slug);
  if (!def) { res.status(404).json({ error: "Kein Standard für diesen Prompt verfügbar" }); return; }
  await query(
    "UPDATE prompts SET template = $1, is_modified = 0, updated_at = NOW() WHERE slug = $2",
    [def.template, slug],
  );
  clearPromptCache(slug);
  type DbPromptFull = {
    id: number; slug: string; name: string; description: string;
    module: string; template: string; placeholders: string;
    is_modified: number; updated_at: string;
  };
  const row = (await query<DbPromptFull>(
    "SELECT id, slug, name, description, module, template, placeholders, is_modified, updated_at FROM prompts WHERE slug = $1",
    [slug],
  )).rows[0];
  res.json({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    module: row.module,
    template: row.template,
    placeholders: JSON.parse(row.placeholders || "[]") as unknown[],
    isModified: false,
    updatedAt: row.updated_at,
    defaultTemplate: def.template,
  });
});

export default adminRouter;
