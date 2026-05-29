---
name: PG Migration
description: SQLite → PostgreSQL migration details, async patterns, and known gotchas for this project.
---

## Rule
All DB access uses the `query<T>()` helper from `src/lib/db.ts`. It returns `{ rows: T[], rowCount }` — NOT `pg.QueryResult<T>` — to avoid the `QueryResultRow` constraint conflict with typed interfaces.

## Why
`pg.QueryResult<T>` requires `T extends QueryResultRow` (i.e. `[col: string]: any`), which our typed interfaces (e.g. `DbUser`) don't satisfy. Wrapping `pool.query` and returning `{ rows: T[] }` sidesteps the constraint entirely.

## How to apply
- Import `query` from `../lib/db.js` (not from `pg` directly).
- All `getSetting()`, `setSetting()`, `createAnalysisLog()` etc. are async — always `await`.
- `admin-auth.ts` resolves JWT secret from `process.env.SESSION_SECRET` (no DB call at init time) so the module remains synchronous at import.
- `mailer.ts` `getMailSettings()` is async — `sendMail` awaits it.
- `ai-client.ts` `callLLM` is async — all `getSetting()` calls inside it are awaited.
- Timestamp columns are returned as strings (type parsers set in `db.ts`) — `.slice(0,10)` still works.
- SQL placeholders: `$1, $2, ...` (not `?`).
- `INSERT OR IGNORE` → `ON CONFLICT (...) DO NOTHING`.
- `INSERT OR REPLACE` → `ON CONFLICT (...) DO UPDATE SET ...`.
- `lastInsertRowid` → `RETURNING id` + `result.rows[0].id`.
- `COUNT(*)` → `COUNT(*)::int` to get an integer not a string.
- `datetime('now', '-5 minutes')` → `NOW() - INTERVAL '5 minutes'`.

## Tables (8 total)
users, verification_codes, settings, analysis_log, analysis_exports, shared_analyses, share_access_log, prompts
