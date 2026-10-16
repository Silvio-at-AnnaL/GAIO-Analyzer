import { getSetting } from "./admin-db.js";
import { query } from "./db.js";
import { getAnalysisId, getPrepId } from "./log-context.js";
import { logger } from "./logger.js";

export function detectUsageEnvironment(env: Record<string, string | undefined>): "live" | "dev" {
  if (env.GAIO_ENV === "live" || env.GAIO_ENV === "dev") return env.GAIO_ENV;
  return env.REPLIT_DEPLOYMENT ? "live" : "dev";
}
export const usageEnvironment = detectUsageEnvironment(process.env);
export function logUsageEnvironment(): void {
  logger.info({ env: usageEnvironment, GAIO_ENV: process.env.GAIO_ENV ?? null,
    REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT ?? null }, "usage environment");
}

const analysisModules = new Set(["content-relevance", "competitor-content", "faq-quality",
  "llm-discoverability-a", "llm-discoverability-b", "llm-discoverability-rating",
  "competitor-findings", "recommendations"]);
const preparationModules = new Set(["prefill-main", "prefill-url-correction",
  "prefill-replacement", "prefill-relevance", "competitor-search-queries", "competitor-search"]);
export function usageArea(module: string): string {
  if (analysisModules.has(module)) return "analysis";
  if (preparationModules.has(module)) return "preparation";
  if (module === "offer-creator") return "offer";
  if (module === "preflight") return "system";
  return "other";
}
export const DEFAULT_AI_PRICES = { claude: { inputPerMTok: 3, outputPerMTok: 15 } };
export const USAGE_SETTING_DEFAULTS: Record<string, string> = {
  ai_prices: JSON.stringify(DEFAULT_AI_PRICES), search_plan: "free", search_included_credits: "1000",
};
export function validateUsageSettings(body: Record<string, unknown>): string | null {
  if ("ai_prices" in body) {
    try {
      const prices: unknown = typeof body.ai_prices === "string" ? JSON.parse(body.ai_prices) : body.ai_prices;
      if (!prices || typeof prices !== "object" || Array.isArray(prices)) return "Ungültige KI-Preise";
      for (const value of Object.values(prices)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return "Ungültige KI-Preise";
        for (const field of ["inputPerMTok", "outputPerMTok"]) {
          const price = (value as Record<string, unknown>)[field];
          if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return "Ungültige KI-Preise";
        }
      }
    } catch { return "Ungültige KI-Preise"; }
  }
  if ("search_plan" in body && (typeof body.search_plan !== "string" ||
    !["free", "payg", "package", "enterprise"].includes(body.search_plan))) {
    return "Ungültiger Suchplan";
  }
  for (const key of ["search_included_credits", "search_monthly_price_usd", "search_credit_price_usd"]) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === "" && key !== "search_included_credits") continue;
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return "Ungültiger Suchpreis";
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || (key === "search_included_credits" && !Number.isSafeInteger(n))) return "Ungültiger Suchpreis";
  }
  return null;
}

type UsageInput = { kind: "llm"; module: string; provider: string; model: string;
  inputTokens: number | null; outputTokens: number | null } | {
  kind: "search"; credits: number;
};
const pending = new Set<Promise<void>>();

async function insertUsage(input: UsageInput, analysisId: string | null, prepId: string | null): Promise<void> {
  let cost: number | null = null;
  try {
    if (input.kind === "llm") {
      const raw = await getSetting("ai_prices");
      const prices = raw == null ? DEFAULT_AI_PRICES : JSON.parse(raw);
      const price = prices && Object.hasOwn(prices, input.provider) ? prices[input.provider] : undefined;
      if (price && input.inputTokens !== null && input.outputTokens !== null &&
        typeof price.inputPerMTok === "number" && Number.isFinite(price.inputPerMTok) && price.inputPerMTok >= 0 &&
        typeof price.outputPerMTok === "number" && Number.isFinite(price.outputPerMTok) && price.outputPerMTok >= 0) {
        cost = input.inputTokens / 1e6 * price.inputPerMTok + input.outputTokens / 1e6 * price.outputPerMTok;
      }
    } else {
      const plan = await getSetting("search_plan") ?? "free";
      const raw = await getSetting("search_credit_price_usd");
      if (plan === "payg" && raw != null && raw.trim() !== "" && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
        cost = input.credits * Number(raw);
      }
    }
  } catch (err) {
    logger.error({ err, kind: input.kind }, "usage pricing failed");
  }
  const module = input.kind === "llm" ? input.module : "competitor-search";
  await query(`INSERT INTO usage_events
    (env, kind, area, module, provider, model, analysis_id, prep_id,
     input_tokens, output_tokens, search_credits, cost_usd)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
    usageEnvironment, input.kind, usageArea(module), module,
    input.kind === "llm" ? input.provider : "tavily", input.kind === "llm" ? input.model : null,
    analysisId, prepId, input.kind === "llm" ? input.inputTokens : null,
    input.kind === "llm" ? input.outputTokens : null, input.kind === "search" ? input.credits : null, cost,
  ]);
}

// Capture context synchronously, then return without awaiting cached settings or SQL.
export function recordUsage(input: UsageInput): void {
  const analysisId = getAnalysisId() ?? null;
  const prepId = getPrepId() ?? null;
  const task = insertUsage(input, analysisId, prepId).catch(err => {
    logger.error({ err, kind: input.kind }, "usage recording failed");
  });
  pending.add(task);
  void task.finally(() => pending.delete(task));
}
export async function drainUsageWrites(): Promise<void> {
  await Promise.all([...pending]);
}

export function tavilyCredits(data: unknown, depth: "basic" | "advanced" = "basic"): number {
  const usage = data && typeof data === "object" && "usage" in data ? data.usage : null;
  const credits = usage && typeof usage === "object" && "credits" in usage ? usage.credits : null;
  return typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits : depth === "advanced" ? 2 : 1;
}
