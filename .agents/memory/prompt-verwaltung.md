---
name: Prompt-Verwaltung feature
description: How AI prompts are stored, loaded, and edited in the admin UI.
---

All 9 AI prompts are extracted from hardcoded strings and stored in the SQLite `prompts` table (admin.db).

**Key files:**
- `artifacts/api-server/src/lib/prompt-defaults.ts` — source of truth for default prompt text + metadata; exports `PROMPT_DEFAULTS` (array) and `PROMPT_DEFAULTS_MAP` (Map<slug, PromptDefault>)
- `artifacts/api-server/src/lib/prompt-manager.ts` — synchronous `getPrompt(slug)` and `fillTemplate(template, vars)` using DatabaseSync; has in-memory cache with `clearPromptCache(slug?)`
- `artifacts/api-server/src/lib/admin-db.ts` — seeds prompts table from PROMPT_DEFAULTS on startup using INSERT OR IGNORE
- `artifacts/api-server/src/routes/admin.ts` — 4 routes: GET /api/admin/prompts, GET /api/admin/prompts/:slug, PATCH /api/admin/prompts/:slug, POST /api/admin/prompts/:slug/reset
- `artifacts/gaio-analyzer/src/views/admin/PromptVerwaltungView.tsx` — two-panel admin UI; left = grouped prompt list, right = editor with placeholders, char count, save/reset, original diff

**Placeholder syntax:** `{{KEY}}` in templates, filled via `fillTemplate(template, { KEY: value })`.

**Why:** Allows non-developer admins to tune AI prompt language and structure without code deploys. The DB stores the active template; the PROMPT_DEFAULTS_MAP holds the immutable default for reset and diff display.

**Critical pattern:** Admin routes must use BOTH `requireAuth, requireAdmin` as middleware — not just `requireAdmin`. `requireAuth` decodes the JWT and sets `req.adminUser`; `requireAdmin` then checks the role. Omitting `requireAuth` causes 403 on every request even for logged-in admin users.
