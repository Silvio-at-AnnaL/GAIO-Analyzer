import type { Router, Request, RequestHandler } from "express";
import { query } from "../lib/db.js";
import { getSetting } from "../lib/admin-db.js";
import { logger } from "../lib/logger.js";

export function usageFilters(req: Pick<Request, "query">): { params: unknown[] } | { error: string } {
  const env = req.query.env ?? "live";
  if (!["live", "dev", "all"].includes(String(env)) || typeof env !== "string") return { error: "Ungültige Umgebung" };
  const dates: (string | null)[] = [];
  for (const key of ["from", "to"]) {
    const value = req.query[key];
    if (value === undefined || value === "") { dates.push(null); continue; }
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) !== value)) {
      return { error: "Ungültiger Datumsfilter" };
    }
    dates.push(value);
  }
  return { params: [...dates, env === "all" ? null : env] };
}
export const USAGE_FILTER = `WHERE
  ($1::text IS NULL OR created_at >= CASE WHEN $1 ~ '^\\d{4}-\\d{2}-\\d{2}$'
    THEN $1::date::timestamp AT TIME ZONE 'Europe/Berlin' ELSE $1::timestamptz END)
  AND ($2::text IS NULL OR CASE WHEN $2 ~ '^\\d{4}-\\d{2}-\\d{2}$'
    THEN created_at < (($2::date+1)::timestamp AT TIME ZONE 'Europe/Berlin')
    ELSE created_at <= $2::timestamptz END)
  AND ($3::text IS NULL OR env=$3)`;

const TOTALS = `COALESCE(SUM(input_tokens) FILTER (WHERE kind='llm'),0)::float8 AS "inputTokens",
  COALESCE(SUM(output_tokens) FILTER (WHERE kind='llm'),0)::float8 AS "outputTokens",
  SUM(cost_usd) FILTER (WHERE kind='llm')::float8 AS "costUsd",
  COALESCE(SUM(search_credits) FILTER (WHERE kind='search'),0)::float8 AS "searchCredits",
  SUM(cost_usd) FILTER (WHERE kind='search')::float8 AS "searchCostUsd"`;
export function usageCsvField(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
const CSV_COLUMNS = ["id", "created_at", "env", "kind", "area", "module", "provider", "model",
  "analysis_id", "prep_id", "input_tokens", "output_tokens", "search_credits", "cost_usd"];

export function registerUsageRoutes(router: Router, requireAuth: RequestHandler, requireFeature: RequestHandler): void {
  router.get("/usage/summary", requireAuth, requireFeature, async (req, res) => {
    const filters = usageFilters(req);
    if ("error" in filters) { res.status(400).json({ error: filters.error }); return; }
    try {
      const totals = (await query<Record<string, number | null>>(`SELECT ${TOTALS},
        COUNT(DISTINCT analysis_id) FILTER (WHERE kind='llm')::int AS "analysesCount",
        (SUM(cost_usd) FILTER (WHERE kind='llm' AND area='analysis') /
          NULLIF(COUNT(DISTINCT analysis_id) FILTER (WHERE kind='llm'),0))::float8 AS "avgCostPerAnalysis"
        FROM usage_events ${USAGE_FILTER}`, filters.params)).rows[0];
      const groups = await Promise.all(["area", "module", "model"].map(async column =>
        (await query(`SELECT ${column}, COUNT(*)::int AS calls,
          COUNT(*) FILTER (WHERE kind='llm')::int AS "llmCalls",
          COUNT(*) FILTER (WHERE kind='search')::int AS "searchCalls",
          COALESCE(SUM(input_tokens),0)::float8 AS "inputTokens",
          COALESCE(SUM(output_tokens),0)::float8 AS "outputTokens",
          COALESCE(SUM(search_credits),0)::float8 AS "searchCredits",
          SUM(cost_usd)::float8 AS "costUsd"
          FROM usage_events ${USAGE_FILTER} GROUP BY ${column} ORDER BY ${column} NULLS LAST`, filters.params)).rows));
      const byDay = (await query(`SELECT
        TO_CHAR(created_at AT TIME ZONE 'Europe/Berlin','YYYY-MM-DD') AS day,
        SUM(cost_usd) FILTER (WHERE kind='llm')::float8 AS "costUsd",
        COALESCE(SUM(input_tokens) FILTER (WHERE kind='llm'),0)::float8 AS "inputTokens",
        COALESCE(SUM(output_tokens) FILTER (WHERE kind='llm'),0)::float8 AS "outputTokens",
        COALESCE(SUM(search_credits) FILTER (WHERE kind='search'),0)::float8 AS "searchCredits",
        COUNT(DISTINCT analysis_id) FILTER (WHERE kind='llm')::int AS analyses
        FROM usage_events ${USAGE_FILTER} GROUP BY day ORDER BY day`, filters.params)).rows;
      const month = (await query<{ used: number }>(`SELECT COALESCE(SUM(search_credits),0)::float8 AS used
        FROM usage_events WHERE kind='search' AND ($1::text IS NULL OR env=$1)
        AND created_at >= (date_trunc('month',NOW() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')
        AND created_at < ((date_trunc('month',NOW() AT TIME ZONE 'Europe/Berlin')+INTERVAL '1 month') AT TIME ZONE 'Europe/Berlin')`,
      [filters.params[2]])).rows[0];
      const { analysesCount, avgCostPerAnalysis, ...usageTotals } = totals;
      res.json({ totals: usageTotals, analysesCount, avgCostPerAnalysis,
        byArea: groups[0], byModule: groups[1], byModel: groups[2], byDay,
        searchMonth: { used: Number(month.used),
          included: Number(await getSetting("search_included_credits") ?? "1000"),
          plan: await getSetting("search_plan") ?? "free" } });
    } catch (err) {
      logger.error({ err }, "usage summary failed");
      res.status(500).json({ error: "Nutzungsübersicht konnte nicht geladen werden" });
    }
  });
  router.get("/usage/export.csv", requireAuth, requireFeature, async (req, res) => {
    const filters = usageFilters(req);
    if ("error" in filters) { res.status(400).json({ error: filters.error }); return; }
    try {
      const { rows } = await query<Record<string, unknown>>(`SELECT id::text AS id,
        TO_CHAR(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        env,kind,area,module,provider,model,analysis_id,prep_id,input_tokens,output_tokens,search_credits,cost_usd
        FROM usage_events ${USAGE_FILTER} ORDER BY created_at,id`, filters.params);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="usage.csv"');
      res.send("\uFEFF" + [CSV_COLUMNS.join(";"), ...rows.map(row =>
        CSV_COLUMNS.map(column => usageCsvField(row[column])).join(";"))].join("\r\n") + "\r\n");
    } catch (err) {
      logger.error({ err }, "usage export failed");
      res.status(500).json({ error: "Nutzungsexport konnte nicht erstellt werden" });
    }
  });
}
