export const DEFAULT_TECHNICAL_PARAMS = {
  weight_https: 10, weight_crawl: 10, weight_robots: 5, weight_sitemap: 8,
  weight_indexable: 7, weight_canonical: 5, weight_title: 18, weight_description: 12,
  weight_viewport: 5, weight_alt: 10, weight_response: 5, weight_hreflang: 5,
  title_min: 15, title_max: 75, desc_min: 50, desc_max: 170,
  length_factor: 0.5, duplicate_factor: 0.5, html_sitemap_credit: 0.5,
  response_good_ms: 1000, response_ok_ms: 2000, response_ok_credit: 0.6,
  retry_credit: 0.5,
};

export type TechnicalScoreParams = typeof DEFAULT_TECHNICAL_PARAMS;
export type TechnicalComponentKey = "https" | "crawl" | "robots" | "sitemap" |
  "indexable" | "canonical" | "title" | "description" | "viewport" | "alt" |
  "response" | "hreflang";

export interface TechnicalBreakdown {
  components: Array<{
    key: TechnicalComponentKey;
    weight: number;
    fraction: number | null;
    points: number | null;
    detail: Record<string, number | string | boolean | null>;
  }>;
  evaluatedWeight: number;
  params: Pick<TechnicalScoreParams, "title_min" | "title_max" | "desc_min" | "desc_max">;
}
