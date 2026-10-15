import type { TechnicalScoreBreakdown, TechnicalScoreComponent } from "@workspace/api-client-react";
import { labelDefaults } from "./labelDefaults";

export type TechnicalT = (key: string, vars?: Record<string, string | number>) => string;
export const defaultTechnicalT: TechnicalT = (key, vars = {}) =>
  (labelDefaults[key]?.de ?? key).replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? match));

export function technicalDetail(component: TechnicalScoreComponent, t: TechnicalT): string {
  const d = component.detail;
  const vars = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v ?? "")]));
  if (d.uploaded) return t("technical.detail_uploaded");
  switch (component.key) {
    case "crawl": return t(Number(d.recoveredAfterRetry ?? 0) > 0 ? "technical.detail_crawl_recovered" : "technical.detail_crawl", vars);
    case "https": return t(`technical.detail_${d.status}`);
    case "robots": return t(`technical.detail_${d.status}`);
    case "sitemap": return t("technical.detail_sitemap", { ...vars, status: t(`technical.detail_${d.status}`) });
    case "title": case "description": return t("technical.detail_text", vars);
    case "hreflang": return t(d.versions ? "technical.detail_hreflang" : "technical.detail_monolingual", vars);
    default: return t(`technical.detail_${component.key}`, vars);
  }
}

export function technicalTooltip(kind: "title" | "description", breakdown: TechnicalScoreBreakdown | undefined, t: TechnicalT): string {
  const p = breakdown?.params;
  return t(`technical.${kind}_tooltip`, kind === "title"
    ? { min: p?.title_min ?? 15, max: p?.title_max ?? 75 }
    : { min: p?.desc_min ?? 50, max: p?.desc_max ?? 170 });
}

export function technicalPoints(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}
