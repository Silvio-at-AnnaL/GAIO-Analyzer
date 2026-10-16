export type UsagePreset = "today" | "last7" | "last30" | "month" | "prevMonth" | "custom";
export type UsageEnv = "live" | "dev" | "all";

export interface UsageGroupRow {
  calls: number; llmCalls: number; searchCalls: number;
  inputTokens: number; outputTokens: number; searchCredits: number; costUsd: number | null;
}
export interface UsageDay {
  day: string; costUsd: number | null; inputTokens: number; outputTokens: number; searchCredits: number; analyses: number;
}
export type Translate = (key: string, params?: Record<string, string | number>) => string;

const BERLIN_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** Europe/Berlin calendar date of an instant as YYYY-MM-DD. */
export function berlinToday(now: Date): string {
  const p = Object.fromEntries(BERLIN_PARTS.formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Plain-date arithmetic (UTC based, timezone-free). */
export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysInMonth(y: number, m: number): number { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function presetRange(preset: Exclude<UsagePreset, "custom">, now: Date): { from: string; to: string } {
  const today = berlinToday(now);
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "today": return { from: today, to: today };
    case "last7": return { from: addDays(today, -6), to: today };
    case "last30": return { from: addDays(today, -29), to: today };
    case "month": return { from: fmt(y, m, 1), to: today };
    case "prevMonth": {
      const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
      return { from: fmt(py, pm, 1), to: fmt(py, pm, daysInMonth(py, pm)) };
    }
  }
}

export const isPlainDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"))
  && addDays(s, 0) === s;

export function usageQuery(from: string, to: string, env: UsageEnv): string {
  return new URLSearchParams({ from, to, env }).toString();
}
export function usageCsvFilename(from: string, to: string, env: UsageEnv): string {
  return `kosten_${from}_${to}_${env}.csv`;
}

/** Fill every day in [from,to] (inclusive) with zeros where the API returned nothing. */
export function fillDays(byDay: UsageDay[], from: string, to: string): UsageDay[] {
  const map = new Map(byDay.map(d => [d.day, d]));
  const out: UsageDay[] = [];
  if (!isPlainDate(from) || !isPlainDate(to) || from > to) return byDay.slice();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(map.get(d) ?? { day: d, costUsd: 0, inputTokens: 0, outputTokens: 0, searchCredits: 0, analyses: 0 });
  }
  return out;
}

export interface ChartPoint extends UsageDay { cost: number; }
/** Chart data: missing days are 0; null cost is plotted as 0. */
export function chartData(byDay: UsageDay[], from: string, to: string): ChartPoint[] {
  return fillDays(byDay, from, to).map(d => ({ ...d, cost: d.costUsd ?? 0 }));
}

/** Cost descending, nulls last; stable for ties. */
export function sortByCost<T extends { costUsd: number | null }>(rows: T[]): T[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    const x = a.r.costUsd, y = b.r.costUsd;
    if (x == null && y == null) return a.i - b.i;
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || a.i - b.i;
  }).map(o => o.r);
}

export const AREA_IDS = ["analysis", "preparation", "offer", "system", "other"] as const;
export const MODULE_IDS = ["content-relevance", "competitor-content", "faq-quality", "llm-discoverability-a",
  "llm-discoverability-b", "llm-discoverability-rating", "competitor-findings", "recommendations", "prefill-main",
  "prefill-url-correction", "prefill-replacement", "prefill-relevance", "competitor-search-queries",
  "competitor-search", "offer-creator", "preflight"] as const;

export function areaLabel(area: string, t: Translate): string {
  return (AREA_IDS as readonly string[]).includes(area) ? t(`usage.area_${area}`) : area;
}
export function moduleLabel(id: string, t: Translate): string {
  return (MODULE_IDS as readonly string[]).includes(id) ? t(`usage.module_${id}`) : id;
}
export function modelLabel(model: string | null, t: Translate): string {
  return model == null ? t("usage.model_search") : model;
}
