import type { Router, Request, RequestHandler, Response } from "express";
import { query, withTransaction } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { compileExclusionRules, normalizeExclusionPattern, type CrawlExclusionRule } from "../lib/crawl-exclusions.js";
import { invalidateCrawlExclusionCache } from "../lib/crawl-exclusion-store.js";

interface RuleRow extends CrawlExclusionRule {
  id: number;
  note: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}
type RuleInput = Partial<Pick<RuleRow, "pattern" | "is_active" | "count_in_report" | "note">>;
const COLUMNS = "id, pattern, is_active, count_in_report, note, created_at, updated_at";

class ValidationError extends Error {}
function validate(body: unknown, creating: boolean): RuleInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Ungültige Eingabe.");
  const input = body as Record<string, unknown>;
  const fields = ["pattern", "is_active", "count_in_report", "note"];
  if (!Object.keys(input).length || Object.keys(input).some(key => !fields.includes(key))) {
    throw new ValidationError("Bitte geben Sie nur die vorgesehenen Regelfelder an.");
  }
  const result: RuleInput = {};
  if (creating || Object.hasOwn(input, "pattern")) {
    if (typeof input.pattern !== "string") throw new ValidationError("Bitte geben Sie ein Muster ein.");
    const pattern = normalizeExclusionPattern(input.pattern);
    if (!pattern) throw new ValidationError("Das Muster darf nicht leer sein.");
    if ([...pattern].length > 100) throw new ValidationError("Das Muster darf höchstens 100 Zeichen enthalten.");
    if (/\s/u.test(pattern)) throw new ValidationError("Das Muster darf keine Leerzeichen enthalten.");
    if (/[/?&=#]/u.test(pattern)) throw new ValidationError("Das Muster darf die Zeichen /, ?, &, = und # nicht enthalten.");
    if ([...pattern.replaceAll("*", "")].length < 2) {
      throw new ValidationError("Das Muster muss mindestens zwei Zeichen außer * enthalten.");
    }
    result.pattern = pattern;
  }
  for (const field of ["is_active", "count_in_report"] as const) {
    if (Object.hasOwn(input, field)) {
      if (typeof input[field] !== "boolean") throw new ValidationError("Aktiv und im Report zählen müssen Wahrheitswerte sein.");
      result[field] = input[field];
    } else if (creating) result[field] = true;
  }
  if (Object.hasOwn(input, "note")) {
    if (input.note !== null && typeof input.note !== "string") throw new ValidationError("Die Notiz muss ein Text sein.");
    if (typeof input.note === "string" && [...input.note].length > 300) {
      throw new ValidationError("Die Notiz darf höchstens 300 Zeichen enthalten.");
    }
    result.note = input.note as string | null;
  } else if (creating) result.note = null;
  return result;
}
function ruleId(req: Request): number {
  const value = req.params.id as string;
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) throw new ValidationError("Ungültige Regel-ID.");
  return id;
}
function failure(res: Response, err: unknown, pattern?: string): void {
  if (err instanceof ValidationError) { res.status(400).json({ error: err.message }); return; }
  if ((err as { code?: string })?.code === "23505") {
    res.status(409).json({ error: `Das Muster „${pattern}“ ist bereits vorhanden.` }); return;
  }
  logger.error({ err }, "crawl exclusion rule request failed");
  res.status(500).json({ error: "Die Crawl-Ausschlüsse konnten nicht verarbeitet werden. Bitte versuchen Sie es später erneut." });
}
function changed(req: Request, action: string, before: RuleRow | undefined, after?: RuleRow): void {
  const row = after ?? before!;
  invalidateCrawlExclusionCache();
  logger.info({ action, id: row.id, pattern: row.pattern, before, after, userId: req.adminUser!.id }, "crawl exclusion rule changed");
}

export function registerCrawlExclusionRoutes(router: Router, auth: RequestHandler, feature: RequestHandler): void {
  router.get("/crawl-exclusions", auth, feature, async (_req, res) => {
    try { res.json((await query<RuleRow>(`SELECT ${COLUMNS} FROM crawl_exclusion_rules ORDER BY pattern`)).rows); }
    catch (err) { failure(res, err); }
  });
  router.post("/crawl-exclusions/test", auth, feature, async (req, res) => {
    let url: string;
    try {
      if (typeof req.body?.url !== "string") throw new Error();
      const parsed = new URL(req.body.url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      url = parsed.href;
    } catch {
      res.status(400).json({ error: "Bitte geben Sie eine gültige vollständige HTTP- oder HTTPS-URL ein." }); return;
    }
    try {
      const rows = (await query<RuleRow>(`SELECT ${COLUMNS} FROM crawl_exclusion_rules ORDER BY pattern`)).rows;
      const matcher = compileExclusionRules(rows);
      const matches = rows.filter(row => compileExclusionRules([{ ...row, is_active: true }]).isExcluded(url))
        .map(({ id, pattern, is_active, count_in_report }) => ({ id, pattern, is_active, count_in_report }));
      res.json({ excluded: matcher.isExcluded(url), countedInReport: matcher.countsInReport(url), matches });
    } catch (err) { failure(res, err); }
  });
  router.post("/crawl-exclusions", auth, feature, async (req, res) => {
    let pattern: string | undefined;
    try {
      const input = validate(req.body, true); pattern = input.pattern;
      const row = (await query<RuleRow>(
        `INSERT INTO crawl_exclusion_rules (pattern, is_active, count_in_report, note) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
        [pattern, input.is_active, input.count_in_report, input.note],
      )).rows[0];
      changed(req, "create", undefined, row);
      res.status(201).json(row);
    } catch (err) { failure(res, err, pattern); }
  });
  router.patch("/crawl-exclusions/:id", auth, feature, async (req, res) => {
    let pattern: string | undefined;
    try {
      const id = ruleId(req), input = validate(req.body, false); pattern = input.pattern;
      const result = await withTransaction(async client => {
        const before = (await client.query<RuleRow>(`SELECT ${COLUMNS} FROM crawl_exclusion_rules WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!before) return null;
        const next = { ...before, ...input }; pattern = next.pattern;
        const after = (await client.query<RuleRow>(
          `UPDATE crawl_exclusion_rules SET pattern = $1, is_active = $2, count_in_report = $3, note = $4, updated_at = now() WHERE id = $5 RETURNING ${COLUMNS}`,
          [next.pattern, next.is_active, next.count_in_report, next.note, id],
        )).rows[0];
        return { before, after };
      });
      if (!result) { res.status(404).json({ error: "Die Regel wurde nicht gefunden." }); return; }
      changed(req, "update", result.before, result.after);
      res.json(result.after);
    } catch (err) { failure(res, err, pattern); }
  });
  router.delete("/crawl-exclusions/:id", auth, feature, async (req, res) => {
    try {
      const id = ruleId(req);
      const before = (await query<RuleRow>(`DELETE FROM crawl_exclusion_rules WHERE id = $1 RETURNING ${COLUMNS}`, [id])).rows[0];
      if (!before) { res.status(404).json({ error: "Die Regel wurde nicht gefunden." }); return; }
      changed(req, "delete", before);
      res.json({ ok: true });
    } catch (err) { failure(res, err); }
  });
}
