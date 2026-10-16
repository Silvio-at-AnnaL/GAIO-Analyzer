export interface PriceDraft {
  input: string;
  output: string;
}

function priceMap(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid price map");
  return value as Record<string, unknown>;
}

export function providerPrice(raw: string, providerId: string): PriceDraft {
  try {
    const value = priceMap(raw)[providerId] as { inputPerMTok?: number; outputPerMTok?: number } | undefined;
    return { input: value?.inputPerMTok == null ? "" : String(value.inputPerMTok),
      output: value?.outputPerMTok == null ? "" : String(value.outputPerMTok) };
  } catch { return { input: "", output: "" }; }
}

export function mergeProviderPrice(raw: string, providerId: string, draft: PriceDraft): string {
  const prices = priceMap(raw);
  if (draft.input.trim() === "" && draft.output.trim() === "") delete prices[providerId];
  else prices[providerId] = {
    inputPerMTok: draft.input.trim() === "" ? null : Number(draft.input),
    outputPerMTok: draft.output.trim() === "" ? null : Number(draft.output),
  };
  return JSON.stringify(prices);
}

export interface SearchPlanSettings {
  search_plan?: string;
  search_included_credits?: string;
  search_monthly_price_usd?: string;
  search_credit_price_usd?: string;
}

export function searchPlanPatch(settings: SearchPlanSettings): Record<string, string> {
  const plan = settings.search_plan ?? "free";
  const patch: Record<string, string> = { search_plan: plan };
  if (["free", "package", "enterprise"].includes(plan)) {
    const included = settings.search_included_credits ?? "1000";
    // The existing API does not accept a blank integer. An optional blank
    // Enterprise allowance is omitted, not silently replaced with zero.
    if (plan !== "enterprise" || included.trim() !== "") patch.search_included_credits = included;
  }
  if (["package", "enterprise"].includes(plan)) patch.search_monthly_price_usd = settings.search_monthly_price_usd ?? "";
  if (plan !== "free") patch.search_credit_price_usd = settings.search_credit_price_usd ?? "";
  return patch;
}

export function searchUsageLevel(used: number, included: number): "normal" | "amber" | "red" {
  const ratio = included > 0 ? used / included : used > 0 ? Infinity : 0;
  return ratio >= 1 ? "red" : ratio >= 0.8 ? "amber" : "normal";
}

interface UsagePart {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}
export interface AdminUsageSnapshot {
  currency: string;
  analysis: UsagePart;
  preparation: UsagePart & { searchCredits: number; searchCostUsd: number | null };
}
type Translate = (key: string, params?: Record<string, string | number>) => string;
const usd = new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numbers = new Intl.NumberFormat("de-DE");
const isCost = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function formatAdminCost(value: number | null, t: Translate): string {
  if (!isCost(value)) return t("log.cost_unavailable");
  if (value > 0 && value < 0.01) return t("log.cost_tiny");
  return usd.format(value);
}

export function usageCostCell(usage: AdminUsageSnapshot | null | undefined, t: Translate): { text: string; title?: string } {
  if (!usage) return { text: t("log.cost_unavailable") };
  const a = usage.analysis;
  const p = usage.preparation;
  const total = isCost(a.costUsd) || isCost(p.costUsd) ? (a.costUsd ?? 0) + (p.costUsd ?? 0) : null;
  const lines = [t("log.cost_analysis", { cost: formatAdminCost(a.costUsd, t),
    input: numbers.format(a.inputTokens), output: numbers.format(a.outputTokens) })];
  if (p.calls > 0) lines.push(t("log.cost_preparation", { cost: formatAdminCost(p.costUsd, t),
    input: numbers.format(p.inputTokens), output: numbers.format(p.outputTokens) }));
  if (p.searchCredits > 0) lines.push(t("log.cost_search", { credits: numbers.format(p.searchCredits) }) +
    (isCost(p.searchCostUsd) ? ` · ${formatAdminCost(p.searchCostUsd, t)}` : ""));
  return { text: formatAdminCost(total, t), title: lines.join("\n") };
}
