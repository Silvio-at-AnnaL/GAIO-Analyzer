import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { mkdirSync } from "node:fs";
import bcrypt from "bcryptjs";
import { logger } from "./logger.js";

const DB_DIR = path.join(process.cwd(), "server");
const DB_PATH = path.join(DB_DIR, "admin.db");

mkdirSync(DB_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT    UNIQUE NOT NULL,
    username       TEXT    UNIQUE NOT NULL,
    password_hash  TEXT    NOT NULL,
    first_name     TEXT    NOT NULL,
    last_name      TEXT    NOT NULL,
    role           TEXT    NOT NULL DEFAULT 'user',
    is_active      INTEGER NOT NULL DEFAULT 0,
    must_change_pw INTEGER NOT NULL DEFAULT 1,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by     INTEGER  REFERENCES users(id),
    last_login     DATETIME
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    code       TEXT    NOT NULL,
    purpose    TEXT    NOT NULL,
    new_value  TEXT,
    expires_at DATETIME NOT NULL,
    used       INTEGER  NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS analysis_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_uuid   TEXT,
    domain          TEXT NOT NULL,
    company_name    TEXT,
    triggered_by    TEXT,
    user_session    TEXT,
    gaio_score      INTEGER,
    scores_json     TEXT,
    pages_crawled   INTEGER,
    status          TEXT NOT NULL DEFAULT 'running',
    error_message   TEXT,
    started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    html_export_id  INTEGER
  );

  CREATE TABLE IF NOT EXISTS analysis_exports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id     INTEGER NOT NULL REFERENCES analysis_log(id),
    html_content    TEXT NOT NULL,
    file_size_kb    INTEGER,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Default settings seed ─────────────────────────────────────────────────────
const DEFAULT_SETTINGS: [string, string][] = [
  ["ai_provider",              "claude"],
  ["ai_model_claude",          "claude-sonnet-4-20250514"],
  ["ai_api_key_claude",        ""],
  ["ai_model_openai",          "gpt-4o"],
  ["ai_api_key_openai",        ""],
  ["ai_api_key_perplexity",    ""],
  ["ai_model_perplexity",      "llama-3.1-sonar-large-128k-online"],
  ["ai_api_key_gemini",        ""],
  ["ai_model_gemini",          "gemini-1.5-pro"],
  ["mail_host",                ""],
  ["mail_port",                "587"],
  ["mail_secure",              "false"],
  ["mail_user",                ""],
  ["mail_password",            ""],
  ["mail_from_name",           "GAIO Analyzer"],
  ["mail_from_address",        "silvio.haase@industrystock.com"],
  ["delivery_mode",            "download"],
  ["delivery_bcc",             ""],
  ["delivery_require_email",   "false"],
];
const _seedStmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
for (const [k, v] of DEFAULT_SETTINGS) _seedStmt.run(k, v);

const count = (db.prepare("SELECT COUNT(*) as c FROM users").get() as unknown as { c: number }).c;
if (count === 0) {
  const hash = bcrypt.hashSync("Superadmin007!", 12);
  db.prepare(`
    INSERT INTO users (email, username, password_hash, first_name, last_name, role, is_active, must_change_pw)
    VALUES (?, ?, ?, ?, ?, 'admin', 1, 0)
  `).run("silvio.haase@industrystock.com", "GAIOanalyzerAdmin1!", hash, "Silvio", "Haase");
  logger.info("Default admin user seeded");
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as unknown as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
    .run(key, value);
}

// ── Auto-seed AI settings from Replit AI Integration env vars ────────────────
// If the Replit proxy env vars are present and the admin hasn't stored a custom
// Claude API key yet, write the integration credentials into the settings table
// so the admin form shows them as configured.
{
  const replitKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "";
  const replitUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "";
  if (replitKey && replitUrl) {
    const current = getSetting("ai_api_key_claude") ?? "";
    if (!current) {
      setSetting("ai_api_key_claude", replitKey);
      const currentModel = getSetting("ai_model_claude") ?? "";
      if (!currentModel) setSetting("ai_model_claude", "claude-sonnet-4-6");
      logger.info("Claude API key auto-seeded from Replit AI Integration");
    }
  }
}

// ── Analysis log helpers ──────────────────────────────────────────────────────

export function createAnalysisLog(opts: {
  uuid: string;
  domain: string;
  companyName?: string | null;
  mode: "url" | "html";
  userSession?: string | null;
}): number {
  const result = db.prepare(`
    INSERT INTO analysis_log (analysis_uuid, domain, company_name, triggered_by, user_session, status, started_at)
    VALUES (?, ?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)
  `).run(opts.uuid, opts.domain, opts.companyName ?? null, opts.mode, opts.userSession ?? null);
  return Number(result.lastInsertRowid);
}

export function updateAnalysisLogComplete(id: number, gaioScore: number, scoresJson: string, pagesCrawled: number): void {
  db.prepare(`
    UPDATE analysis_log
    SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
        gaio_score = ?, scores_json = ?, pages_crawled = ?
    WHERE id = ?
  `).run(gaioScore, scoresJson, pagesCrawled, id);
}

export function updateAnalysisLogFailed(id: number, errorMessage: string): void {
  db.prepare(`
    UPDATE analysis_log
    SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ?
    WHERE id = ?
  `).run(errorMessage, id);
}

export function saveAnalysisExport(analysisLogId: number, htmlContent: string): number {
  const fileSizeKb = Math.round(htmlContent.length / 1024);
  const result = db.prepare(`
    INSERT INTO analysis_exports (analysis_id, html_content, file_size_kb, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(analysisLogId, htmlContent, fileSizeKb);
  const exportId = Number(result.lastInsertRowid);
  db.prepare("UPDATE analysis_log SET html_export_id = ? WHERE id = ?").run(exportId, analysisLogId);
  return exportId;
}
