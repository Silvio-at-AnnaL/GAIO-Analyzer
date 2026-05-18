import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db } from "../lib/admin-db.js";
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
    res.json({ requiresVerification: true }); return;
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

export default adminRouter;
