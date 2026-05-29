import bcrypt from "bcryptjs";
import { logger } from "./logger.js";
import { PROMPT_DEFAULTS } from "./prompt-defaults.js";
import { query } from "./db.js";

// ── Schema ────────────────────────────────────────────────────────────────────

const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS users (
    id             SERIAL       PRIMARY KEY,
    email          TEXT         UNIQUE NOT NULL,
    username       TEXT         UNIQUE NOT NULL,
    password_hash  TEXT         NOT NULL,
    first_name     TEXT         NOT NULL,
    last_name      TEXT         NOT NULL,
    role           TEXT         NOT NULL DEFAULT 'user',
    is_active      SMALLINT     NOT NULL DEFAULT 0,
    must_change_pw SMALLINT     NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ  DEFAULT NOW(),
    created_by     INTEGER      REFERENCES users(id),
    last_login     TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id         SERIAL      PRIMARY KEY,
    user_id    INTEGER     NOT NULL REFERENCES users(id),
    code       TEXT        NOT NULL,
    purpose    TEXT        NOT NULL,
    new_value  TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    used       SMALLINT    NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT        PRIMARY KEY,
    value      TEXT        NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS analysis_log (
    id              SERIAL      PRIMARY KEY,
    analysis_uuid   TEXT,
    domain          TEXT        NOT NULL,
    company_name    TEXT,
    triggered_by    TEXT,
    user_session    TEXT,
    gaio_score      INTEGER,
    scores_json     TEXT,
    pages_crawled   INTEGER,
    status          TEXT        NOT NULL DEFAULT 'running',
    error_message   TEXT,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    html_export_id  INTEGER
  );

  CREATE TABLE IF NOT EXISTS analysis_exports (
    id           SERIAL      PRIMARY KEY,
    analysis_id  INTEGER     NOT NULL REFERENCES analysis_log(id),
    html_content TEXT        NOT NULL,
    file_size_kb INTEGER,
    created_at   TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS shared_analyses (
    id          SERIAL      PRIMARY KEY,
    token       TEXT        UNIQUE NOT NULL,
    analysis_id INTEGER     REFERENCES analysis_log(id),
    created_by  INTEGER     REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    is_active   SMALLINT    NOT NULL DEFAULT 1,
    title       TEXT,
    view_count  INTEGER     NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS share_access_log (
    id          SERIAL      PRIMARY KEY,
    share_id    INTEGER     NOT NULL REFERENCES shared_analyses(id),
    accessed_at TIMESTAMPTZ DEFAULT NOW(),
    ip_hash     TEXT,
    user_agent  TEXT
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id           SERIAL      PRIMARY KEY,
    slug         TEXT        UNIQUE NOT NULL,
    name         TEXT        NOT NULL,
    description  TEXT        NOT NULL,
    module       TEXT        NOT NULL,
    template     TEXT        NOT NULL,
    placeholders TEXT        NOT NULL DEFAULT '[]',
    is_modified  SMALLINT    NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  );
`;

// ── Default settings ──────────────────────────────────────────────────────────

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
  ["ai_custom_providers",      "[]"],
  ["branding_logo_base64",     ""],
  ["branding_logo_mimetype",   "image/png"],
  ["branding_footer_text",     "IndustryStock.com"],
  ["branding_footer_url",      "https://www.industrystock.com"],
  ["contact_name",             "Silvio Haase"],
  ["contact_title",            "CMO & Head of Business Development"],
  ["contact_company",          "Deutscher Medien Verlag GmbH / IndustryStock.com"],
  ["contact_email",            "Silvio.Haase@IndustryStock.com"],
  ["contact_photo_base64",     ""],
  ["contact_photo_mimetype",   "image/jpeg"],
  ["contact_cta_text",         "Sie haben Fragen zum GAIO Analyzer, möchten eine Analyse für Ihr Unternehmen durchführen lassen oder interessieren sich für eine individuelle Beratung zur LLM-Sichtbarkeit Ihrer Website?"],
  ["contact_cta_subtext",      "Sprechen Sie uns einfach an — wir antworten schnell und unkompliziert."],
  ["permissions_json",         '{"nutzerverwaltung":["admin"],"analyseprotokoll":["admin"],"erscheinungsbild":["admin"],"kontakt_daten":["admin"],"rechtemanagement":["admin"],"ki_tool":["admin"],"mailserver":["admin"],"versand_analyse":["admin"]}'],
  ["sharing_base_url",         ""],
  ["sharing_default_expiry_days", "30"],
  ["sharing_enabled",          "true"],
  ["theme_primary",            "#2563eb"],
  ["theme_sidebar_bg",         "#1e2235"],
  ["theme_sidebar_text",       "#94a3b8"],
  ["theme_accent",             "#f59e0b"],
  ["theme_colorblind_mode",    "false"],
];

// ── Public init ───────────────────────────────────────────────────────────────

export async function initializeDatabase(): Promise<void> {
  // Create all tables
  await query(CREATE_TABLES);

  // Seed default settings (ON CONFLICT DO NOTHING = INSERT OR IGNORE)
  for (const [k, v] of DEFAULT_SETTINGS) {
    await query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
      [k, v],
    );
  }

  // Seed default prompts
  for (const p of PROMPT_DEFAULTS) {
    await query(
      `INSERT INTO prompts (slug, name, description, module, template, placeholders)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO NOTHING`,
      [p.slug, p.name, p.description, p.module, p.template, JSON.stringify(p.placeholders)],
    );
  }

  // Seed default admin user if no users exist
  const countResult = await query<{ c: string }>("SELECT COUNT(*)::int as c FROM users");
  if (parseInt(countResult.rows[0].c, 10) === 0) {
    const hash = await bcrypt.hash("Superadmin007!", 12);
    await query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name, role, is_active, must_change_pw)
       VALUES ($1, $2, $3, $4, $5, 'admin', 1, 0)`,
      ["silvio.haase@industrystock.com", "GAIOanalyzerAdmin1!", hash, "Silvio", "Haase"],
    );
    logger.info("Default admin user seeded");
  }

  // Auto-seed Claude API key from Replit AI Integration env vars
  const replitKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "";
  const replitUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "";
  if (replitKey && replitUrl) {
    const current = await getSetting("ai_api_key_claude");
    if (!current) {
      await setSetting("ai_api_key_claude", replitKey);
      const currentModel = await getSetting("ai_model_claude");
      if (!currentModel) await setSetting("ai_model_claude", "claude-sonnet-4-6");
      logger.info("Claude API key auto-seeded from Replit AI Integration");
    }
  }

  // Auto-register missing permission entries
  const ALL_FEATURE_IDS = [
    "nutzerverwaltung", "analyseprotokoll", "geteilte_analysen", "angebots_creator",
    "erscheinungsbild", "kontakt_daten", "rechtemanagement",
    "ki_tool", "mailserver", "versand_analyse",
  ];
  try {
    const raw = await getSetting("permissions_json");
    const current = JSON.parse(raw ?? "{}") as Record<string, string[]>;
    let changed = false;
    for (const id of ALL_FEATURE_IDS) {
      if (!(id in current)) { current[id] = ["admin"]; changed = true; }
    }
    if (changed) {
      await setSetting("permissions_json", JSON.stringify(current));
      logger.info("Permissions auto-registered for new features");
    }
  } catch { /* ignore */ }

  logger.info("Database initialized");
}

// ── Settings helpers ──────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const result = await query<{ value: string }>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return result.rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

// ── Analysis log helpers ──────────────────────────────────────────────────────

export async function createAnalysisLog(opts: {
  uuid: string;
  domain: string;
  companyName?: string | null;
  mode: "url" | "html";
  userSession?: string | null;
}): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO analysis_log (analysis_uuid, domain, company_name, triggered_by, user_session, status, started_at)
     VALUES ($1, $2, $3, $4, $5, 'running', NOW())
     RETURNING id`,
    [opts.uuid, opts.domain, opts.companyName ?? null, opts.mode, opts.userSession ?? null],
  );
  return result.rows[0].id;
}

export async function updateAnalysisLogComplete(
  id: number,
  gaioScore: number,
  scoresJson: string,
  pagesCrawled: number,
): Promise<void> {
  await query(
    `UPDATE analysis_log
     SET status = 'completed', completed_at = NOW(),
         gaio_score = $1, scores_json = $2, pages_crawled = $3
     WHERE id = $4`,
    [gaioScore, scoresJson, pagesCrawled, id],
  );
}

export async function updateAnalysisLogFailed(id: number, errorMessage: string): Promise<void> {
  await query(
    `UPDATE analysis_log
     SET status = 'failed', completed_at = NOW(), error_message = $1
     WHERE id = $2`,
    [errorMessage, id],
  );
}

export async function saveAnalysisExport(
  analysisLogId: number,
  htmlContent: string,
): Promise<number> {
  const fileSizeKb = Math.round(htmlContent.length / 1024);
  const exportResult = await query<{ id: number }>(
    `INSERT INTO analysis_exports (analysis_id, html_content, file_size_kb, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id`,
    [analysisLogId, htmlContent, fileSizeKb],
  );
  const exportId = exportResult.rows[0].id;
  await query(
    "UPDATE analysis_log SET html_export_id = $1 WHERE id = $2",
    [exportId, analysisLogId],
  );
  return exportId;
}
