import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db, getSetting, setSetting, saveAnalysisExport } from "../lib/admin-db.js";
import { sendMail, type MailOptions } from "../lib/mailer.js";
import { signToken, verifyToken, validatePasswordPolicy, generateTempPassword } from "../lib/admin-auth.js";
import { sendEmail } from "../lib/admin-email.js";
import { logger } from "../lib/logger.js";

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

/** Split a BCC setting string (comma- or newline-separated) into clean addresses. */
function parseBccList(raw: string): string[] {
  return raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
}

// ── Public endpoints (no auth required) ──────────────────────────────────────

// GET /api/admin/public/delivery-mode — returns current delivery mode
adminRouter.get("/public/delivery-mode", (_req: Request, res: Response) => {
  const raw = getSetting("delivery_mode") ?? "download";
  res.json({ mode: raw === "mail-only" ? "mail-only" : "download" });
});

// POST /api/admin/public/send-report — public send-report for end-user delivery
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
  const bccList    = parseBccList(getSetting("delivery_bcc") ?? "");
  const today      = new Date().toLocaleDateString("de-DE");
  const safeBase   = domainStr.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);

  let logId: number;
  try {
    const r = db.prepare(`
      INSERT INTO analysis_log
        (domain, company_name, gaio_score, scores_json, pages_crawled,
         status, triggered_by, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, 'completed', 'mail-delivery', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      domainStr,
      companyName ? String(companyName) : null,
      typeof gaioScore === "number" ? gaioScore : null,
      scoresJson ? String(scoresJson) : null,
      typeof pagesCrawled === "number" ? pagesCrawled : null,
    );
    logId = r.lastInsertRowid as number;

    if (htmlContent && typeof htmlContent === "string") {
      saveAnalysisExport(logId, htmlContent);
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

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as unknown as DbUser | undefined;
  if (!user) { res.status(401).json({ error: "Ungültige Anmeldedaten" }); return; }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) { res.status(401).json({ error: "Ungültige Anmeldedaten" }); return; }

  db.prepare("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);

  if (user.must_change_pw === 1) {
    res.json({ mustChangePw: true, user: safeUser(user) });
    return;
  }

  if (user.is_active === 0) {
    db.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(user.id);
  }

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  res.cookie("gaio_admin_token", token, COOKIE_OPTS);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as unknown as DbUser;
  res.json({ user: safeUser(fresh) });
});

adminRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("gaio_admin_token", { path: "/" });
  res.json({ ok: true });
});

adminRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.adminUser!.id) as unknown as DbUser | undefined;
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

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as unknown as DbUser | undefined;
  if (!user || user.must_change_pw !== 1) {
    res.status(400).json({ error: "Ungültige Anfrage" }); return;
  }

  const valid = await bcrypt.compare(tempPassword, user.password_hash);
  if (!valid) { res.status(401).json({ error: "Temporäres Passwort ist falsch" }); return; }

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.valid) { res.status(400).json({ error: "Passwortrichtlinie nicht erfüllt", details: policy.errors }); return; }

  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare("UPDATE users SET password_hash = ?, must_change_pw = 0, is_active = 1, last_login = CURRENT_TIMESTAMP WHERE id = ?")
    .run(hash, user.id);

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  res.cookie("gaio_admin_token", token, COOKIE_OPTS);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as unknown as DbUser;
  res.json({ user: safeUser(fresh) });
});

// ── User management (admin only) ──────────────────────────────────────────────

adminRouter.get("/users", requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as unknown as DbUser[];
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
  while (db.prepare("SELECT id FROM users WHERE username = ?").get(username)) {
    username = base + n++;
  }

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);
  db.prepare(`
    INSERT INTO users (email, username, password_hash, first_name, last_name, role, is_active, must_change_pw, created_by)
    VALUES (?, ?, ?, ?, ?, 'user', 0, 1, ?)
  `).run(email, username, hash, firstName, lastName, req.adminUser!.id);

  const newUser = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as unknown as DbUser;
  logger.info({ actor: req.adminUser!.username, action: "user_created", target: username }, "Admin created user");

  await sendEmail({
    to: email,
    subject: "Ihr Zugang zum GAIO Analyzer",
    text: `Guten Tag ${firstName} ${lastName},\n\nIhr Zugang zum GAIO Analyzer wurde eingerichtet.\n\nBenutzername: ${username}\nTemporäres Passwort: ${tempPassword}\n\nBitte melden Sie sich an und ändern Sie Ihr Passwort beim ersten Login.\n\nDas temporäre Passwort ist 48 Stunden gültig.`,
  });

  res.status(201).json({ user: safeUser(newUser) });
});

adminRouter.patch("/users/:id/role", requireAuth, requireAdmin, (req: Request, res: Response) => {
  const targetId = parseInt(String(req.params.id), 10);
  const { role } = req.body ?? {};

  if (!["admin", "user_extended", "user"].includes(role)) {
    res.status(400).json({ error: "Ungültige Rolle" }); return;
  }

  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as unknown as DbUser | undefined;
  if (!target) { res.status(404).json({ error: "Benutzer nicht gefunden" }); return; }

  if (role === "admin" && target.is_active === 0) {
    res.status(400).json({ error: "Rolle 'admin' kann nur aktiven Benutzern zugewiesen werden" }); return;
  }

  if (targetId === req.adminUser!.id && role !== "admin") {
    const adminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as unknown as { c: number }).c;
    if (adminCount <= 1) {
      res.status(400).json({ error: "Sie sind der einzige Admin und können sich nicht selbst degradieren" }); return;
    }
  }

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, targetId);
  logger.info({ actor: req.adminUser!.username, action: "role_changed", target: target.username, newRole: role }, "Admin changed role");

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as unknown as DbUser;
  res.json({ user: safeUser(updated) });
});

adminRouter.delete("/users/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
  const targetId = parseInt(String(req.params.id), 10);
  if (targetId === req.adminUser!.id) {
    res.status(400).json({ error: "Sie können sich nicht selbst löschen" }); return;
  }

  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as unknown as DbUser | undefined;
  if (!target) { res.status(404).json({ error: "Benutzer nicht gefunden" }); return; }

  db.prepare("DELETE FROM verification_codes WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
  logger.info({ actor: req.adminUser!.username, action: "user_deleted", target: target.username }, "Admin deleted user");

  res.json({ ok: true });
});

// ── Profile ───────────────────────────────────────────────────────────────────

adminRouter.get("/profile", requireAuth, (req: Request, res: Response) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.adminUser!.id) as unknown as DbUser | undefined;
  if (!user) { res.status(404).json({ error: "Benutzer nicht gefunden" }); return; }
  res.json({ user: safeUser(user) });
});

adminRouter.patch("/profile", requireAuth, async (req: Request, res: Response) => {
  const { firstName, lastName, newUsername, newEmail, currentPassword, newPassword } = req.body ?? {};
  const userId = req.adminUser!.id;

  let user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser;

  if (firstName || lastName) {
    const fn = firstName?.trim() || user.first_name;
    const ln = lastName?.trim() || user.last_name;
    db.prepare("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?").run(fn, ln, userId);
    await sendEmail({ to: user.email, subject: "Ihre Daten wurden geändert – GAIO Analyzer", text: `Ihr Name wurde aktualisiert auf: ${fn} ${ln}` });
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser;
  }

  if (newUsername) {
    if (!currentPassword) { res.status(400).json({ error: "Aktuelles Passwort für Benutzernamensänderung erforderlich" }); return; }
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) { res.status(401).json({ error: "Aktuelles Passwort ist falsch" }); return; }
    if (db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(newUsername, userId)) {
      res.status(400).json({ error: "Benutzername bereits vergeben" }); return;
    }
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(newUsername, userId);
    const freshUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser;
    const token = signToken({ userId, username: newUsername, role: freshUser.role });
    res.cookie("gaio_admin_token", token, COOKIE_OPTS);
    user = freshUser;
  }

  if (newPassword) {
    if (!currentPassword) { res.status(400).json({ error: "Aktuelles Passwort erforderlich" }); return; }
    const freshUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser;
    const valid = await bcrypt.compare(currentPassword, freshUser.password_hash);
    if (!valid) { res.status(401).json({ error: "Aktuelles Passwort ist falsch" }); return; }
    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) { res.status(400).json({ error: "Passwortrichtlinie nicht erfüllt", details: policy.errors }); return; }
    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
    await sendEmail({ to: user.email, subject: "Ihr Passwort wurde geändert – GAIO Analyzer", text: "Ihr Passwort wurde erfolgreich geändert. Falls Sie diese Änderung nicht beantragt haben, kontaktieren Sie uns sofort." });
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser;
  }

  if (newEmail) {
    if (db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(newEmail, userId)) {
      res.status(400).json({ error: "E-Mail bereits vergeben" }); return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare("INSERT INTO verification_codes (user_id, code, purpose, new_value, expires_at) VALUES (?, ?, 'email_change', ?, ?)")
      .run(userId, code, newEmail, expiresAt);
    await sendEmail({
      to: user.email,
      subject: "Ihr Bestätigungscode – GAIO Analyzer",
      text: `Ihr Bestätigungscode lautet:\n\n${code}\n\nDieser Code ist 15 Minuten gültig.\nFalls Sie diese Änderung nicht beantragt haben, ignorieren Sie diese E-Mail.`,
    });
    res.json({ requiresVerification: true, code }); return;
  }

  const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser;
  res.json({ user: safeUser(updatedUser) });
});

adminRouter.post("/verify-code", requireAuth, (req: Request, res: Response) => {
  const { code, purpose } = req.body ?? {};
  const userId = req.adminUser!.id;

  const record = db.prepare(`
    SELECT * FROM verification_codes
    WHERE user_id = ? AND code = ? AND purpose = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, code, purpose) as unknown as { id: number; new_value: string | null } | undefined;

  if (!record) { res.status(400).json({ error: "Ungültiger oder abgelaufener Code" }); return; }

  db.prepare("UPDATE verification_codes SET used = 1 WHERE id = ?").run(record.id);

  if (purpose === "email_change" && record.new_value) {
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(record.new_value, userId);
  }

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as unknown as DbUser;
  res.json({ user: safeUser(updated) });
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

  try {
    if (logId && typeof logId === "number") {
      // Known log entry — look it up by ID
      const existing = db.prepare(
        "SELECT id, html_export_id FROM analysis_log WHERE id = ?"
      ).get(logId) as unknown as { id: number; html_export_id: number | null } | undefined;

      if (existing) {
        targetLogId = existing.id;
        if (existing.html_export_id) {
          // Already exported — idempotent, skip entirely (no duplicate BCC)
          res.json({ exportId: existing.html_export_id, logId: targetLogId, skipped: true }); return;
        }
        exportId = saveAnalysisExport(targetLogId, htmlContent);
        isFreshExport = true;
        res.json({ exportId, logId: targetLogId });
      } else {
        targetLogId = insertAutoLogEntry();
        exportId = saveAnalysisExport(targetLogId, htmlContent);
        isFreshExport = true;
        res.json({ exportId, logId: targetLogId });
      }
    } else {
      // No logId — check for a recent entry for the same domain (within 5 min)
      // to prevent duplicate log entries when the endpoint is called multiple times.
      const recent = db.prepare(
        `SELECT id, html_export_id FROM analysis_log
         WHERE domain = ? AND status = 'completed'
         AND completed_at > datetime('now', '-5 minutes')
         LIMIT 1`
      ).get(domainStr) as unknown as { id: number; html_export_id: number | null } | undefined;

      if (recent) {
        targetLogId = recent.id;
        if (!recent.html_export_id) {
          exportId = saveAnalysisExport(targetLogId, htmlContent);
        } else {
          exportId = recent.html_export_id;
        }
        // Duplicate — respond but do NOT send another BCC copy
        res.json({ exportId, logId: targetLogId, duplicate: true }); return;
      }

      targetLogId = insertAutoLogEntry();
      exportId = saveAnalysisExport(targetLogId, htmlContent);
      isFreshExport = true;
      res.json({ exportId, logId: targetLogId });
    }
  } catch (err) {
    logger.error({ err }, "Failed to save auto-export");
    res.status(500).json({ error: "Fehler beim Speichern" }); return;
  }

  // ── BCC copy: only for fresh (non-duplicate) exports ─────────────────────────
  if (isFreshExport) {
    const bccList = parseBccList(getSetting("delivery_bcc") ?? "");
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

  function insertAutoLogEntry(): number {
    const r = db.prepare(`
      INSERT INTO analysis_log
        (domain, company_name, gaio_score, scores_json, pages_crawled,
         status, triggered_by, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, 'completed', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      String(domain ?? ""),
      companyName ? String(companyName) : null,
      typeof gaioScore === "number" ? gaioScore : null,
      scoresJson ? String(scoresJson) : null,
      typeof pagesCrawled === "number" ? pagesCrawled : null,
    );
    return r.lastInsertRowid as number;
  }
});

// POST /api/admin/analysis-log/:id/export — NO auth (called from frontend during HTML export)
adminRouter.post("/analysis-log/:id/export", (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.id), 10);
  if (isNaN(logId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

  const { htmlContent } = req.body ?? {};
  if (!htmlContent || typeof htmlContent !== "string") {
    res.status(400).json({ error: "htmlContent fehlt" }); return;
  }

  const entry = db.prepare("SELECT id FROM analysis_log WHERE id = ?").get(logId) as unknown as { id: number } | undefined;
  if (!entry) {
    res.status(404).json({ error: "Analyseeintrag nicht gefunden" }); return;
  }

  try {
    const exportId = saveAnalysisExport(logId, htmlContent);
    res.json({ exportId });
  } catch (err) {
    logger.error({ err }, "Failed to save analysis export");
    res.status(500).json({ error: "Export konnte nicht gespeichert werden" });
  }
});

// GET /api/admin/analysis-log — admin only, paginated
adminRouter.get("/analysis-log", requireAuth, requireAdmin, (req: Request, res: Response) => {
  const page   = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const offset = (page - 1) * limit;
  const statusParam = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
  const searchParam = typeof req.query.search === "string" && req.query.search ? `%${req.query.search}%` : null;

  // Use IS NULL pattern to avoid dynamic SQL spreading — always 5 fixed params
  const total = (db.prepare(`
    SELECT COUNT(*) as c FROM analysis_log al
    WHERE (? IS NULL OR al.status = ?)
      AND (? IS NULL OR al.domain LIKE ? OR al.company_name LIKE ?)
  `).get(statusParam, statusParam, searchParam, searchParam, searchParam) as unknown as { c: number }).c;

  const rows = db.prepare(`
    SELECT al.*,
       CASE WHEN ae.id IS NOT NULL THEN 1 ELSE 0 END as has_html_export
     FROM analysis_log al
     LEFT JOIN analysis_exports ae ON ae.id = al.html_export_id
     WHERE (? IS NULL OR al.status = ?)
       AND (? IS NULL OR al.domain LIKE ? OR al.company_name LIKE ?)
     ORDER BY al.started_at DESC
     LIMIT ? OFFSET ?
  `).all(statusParam, statusParam, searchParam, searchParam, searchParam, limit, offset) as unknown as (AnalysisLogRow & { has_html_export: number })[];

  const storageRow = db.prepare(
    "SELECT COALESCE(SUM(LENGTH(html_content)) / 1024, 0) as total_kb FROM analysis_exports"
  ).get() as unknown as { total_kb: number };

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

  res.json({ items, total, page, pages: Math.ceil(total / limit), storageTotalKb: storageRow.total_kb });
});

// GET /api/admin/analysis-log/:id/export — admin only, returns HTML file
adminRouter.get("/analysis-log/:id/export", requireAuth, requireAdmin, (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.id), 10);
  if (isNaN(logId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

  const row = db.prepare(
    "SELECT ae.html_content, al.domain, al.started_at FROM analysis_exports ae JOIN analysis_log al ON al.id = ae.analysis_id WHERE al.id = ?"
  ).get(logId) as unknown as { html_content: string; domain: string; started_at: string } | undefined;

  if (!row) { res.status(404).json({ error: "Kein HTML-Export vorhanden" }); return; }

  const date = row.started_at.slice(0, 10).replace(/-/g, "");
  const safeDomain = row.domain.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);
  const filename = `GAIO-${safeDomain}-${date}.html`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(row.html_content);
});

// DELETE /api/admin/analysis-log/:id — admin only
adminRouter.delete("/analysis-log/:id", requireAuth, requireAdmin, (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.id), 10);
  if (isNaN(logId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

  const entry = db.prepare("SELECT id FROM analysis_log WHERE id = ?").get(logId) as unknown as { id: number } | undefined;
  if (!entry) { res.status(404).json({ error: "Eintrag nicht gefunden" }); return; }

  try {
    // Remove ALL exports for this analysis by analysis_id (the FK column).
    // Using html_export_id would leave orphaned rows when both auto-save and
    // manual export exist for the same entry, causing a FK violation on the
    // analysis_log delete and crashing the process.
    db.prepare("DELETE FROM analysis_exports WHERE analysis_id = ?").run(logId);
    db.prepare("DELETE FROM analysis_log WHERE id = ?").run(logId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete analysis log entry");
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ── Settings helpers ──────────────────────────────────────────────────────────

const SETTINGS_GROUPS: Record<string, string[]> = {
  ai:       ["ai_provider","ai_model_claude","ai_api_key_claude","ai_model_openai","ai_api_key_openai","ai_api_key_perplexity","ai_model_perplexity","ai_api_key_gemini","ai_model_gemini"],
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

// GET /api/admin/settings/ai-status  ← must be registered BEFORE /:group
adminRouter.get("/settings/ai-status", requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const provider = getSetting("ai_provider") ?? "claude";
  const hasApiKey = {
    claude:     (getSetting("ai_api_key_claude")     ?? "") !== "",
    openai:     (getSetting("ai_api_key_openai")     ?? "") !== "",
    perplexity: (getSetting("ai_api_key_perplexity") ?? "") !== "",
    gemini:     (getSetting("ai_api_key_gemini")     ?? "") !== "",
  };
  const lastRow = db.prepare(
    "SELECT completed_at FROM analysis_log WHERE status='completed' ORDER BY completed_at DESC LIMIT 1"
  ).get() as unknown as { completed_at: string } | undefined;
  res.json({ provider, hasApiKey, lastCompletedAt: lastRow?.completed_at ?? null });
});

// POST /api/admin/settings/test-mail  ← must be registered BEFORE /:group
adminRouter.post("/settings/test-mail", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.adminUser!.id) as unknown as { email: string } | undefined;
  const to = user?.email ?? getSetting("mail_from_address") ?? "";
  if (!to) { res.status(400).json({ success: false, error: "Keine E-Mail-Adresse gefunden" }); return; }

  const result = await sendMail({
    to,
    subject: "GAIO Analyzer — Mailserver-Test",
    text:    "Der Mailserver ist korrekt konfiguriert.",
  });
  res.json(result);
});

// GET /api/admin/settings/:group
adminRouter.get("/settings/:group", requireAuth, requireAdmin, (req: Request, res: Response) => {
  const group = req.params.group;
  const keys = SETTINGS_GROUPS[group];
  if (!keys) { res.status(400).json({ error: "Ungültige Gruppe" }); return; }

  const result: Record<string, string> = {};
  for (const key of keys) {
    const raw = getSetting(key) ?? "";
    result[key] = SECRET_KEYS.has(key) ? maskSecret(raw) : raw;
  }
  res.json(result);
});

// PATCH /api/admin/settings/:group
adminRouter.patch("/settings/:group", requireAuth, requireAdmin, (req: Request, res: Response) => {
  const group = req.params.group;
  const keys = SETTINGS_GROUPS[group];
  if (!keys) { res.status(400).json({ error: "Ungültige Gruppe" }); return; }

  const body = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(body)) {
    if (!keys.includes(key)) continue;
    if (SECRET_KEYS.has(key) && isPlaceholder(String(value))) continue;
    setSetting(key, String(value));
  }
  res.json({ success: true });
});

// POST /api/admin/analysis/:id/send-email
adminRouter.post("/analysis/:id/send-email", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.id), 10);
  if (isNaN(logId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

  const { recipientEmail } = req.body as { recipientEmail?: string };
  if (!recipientEmail) { res.status(400).json({ error: "recipientEmail fehlt" }); return; }

  const exportRow = db.prepare(
    "SELECT html_content FROM analysis_exports WHERE analysis_id = ? ORDER BY id DESC LIMIT 1"
  ).get(logId) as unknown as { html_content: string } | undefined;
  if (!exportRow) { res.status(404).json({ error: "Kein HTML-Export vorhanden" }); return; }

  const logRow = db.prepare("SELECT domain FROM analysis_log WHERE id = ?").get(logId) as unknown as { domain: string } | undefined;
  const domain = logRow?.domain ?? "analyse";
  const bccList = parseBccList(getSetting("delivery_bcc") ?? "");

  const result = await sendMail({
    to:      recipientEmail,
    subject: `GAIO Analyzer Bericht — ${domain}`,
    html:    `<p>Im Anhang finden Sie den GAIO Analyzer Bericht für <strong>${domain}</strong>.</p>`,
    text:    `GAIO Analyzer Bericht für ${domain}`,
    bcc:     bccList.length > 0 ? bccList.join(", ") : undefined,
    attachments: [{
      filename:    `GAIO-${domain.replace(/[^a-z0-9.-]/gi, "_")}.html`,
      content:     exportRow.html_content,
      contentType: "text/html",
    }],
  });
  res.json(result);
});

export default adminRouter;

