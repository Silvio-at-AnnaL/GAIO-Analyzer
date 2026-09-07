import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";

export interface SchemaOrgResult {
  score: number;
  detectedTypes: string[];
  missingHighValue: string[];
  productSchemaDetails: Record<string, boolean>;
  validationErrors: string[];
  breadthScore: number;
  substanceScore: number;
  correctnessFactor: number;
  typeBreakdown: Array<{ type: string; weight: number; objectCount: number; avgSubstance: number }>;
}

const TYPE_WEIGHTS: Record<string, number> = {
  Organization: 3,
  Product: 3,
  FAQPage: 3,
  LocalBusiness: 2,
  WebSite: 2,
  Article: 2,
  Service: 2,
  BlogPosting: 2,
  NewsArticle: 2,
  BreadcrumbList: 1,
  WebPage: 1,
  SiteNavigationElement: 1,
  Blog: 1,
};
const BREADTH_MAX = 40;
const SUBSTANCE_MAX = 60;
const BREADTH_SATURATION = 14;
const SUBSTANCE_SATURATION = 22;
const SUBSTANCE_K = 0.5;
const MALUS_PER_HARD_ERROR = 0.20;
const MALUS_FLOOR = 0.40;
const STRUCTURAL_TYPES = new Set(["BreadcrumbList", "SiteNavigationElement", "WebPage"]);
const TRIVIAL_KEYS = new Set(["@type", "@id", "@context"]);
const HIGH_VALUE_TYPES = ["Organization", "Product", "FAQPage", "BreadcrumbList", "WebPage"];
const PRODUCT_REQUIRED_PROPS = ["name", "description", "offers", "manufacturer", "sku", "image"];

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function objectSubstance(obj: Record<string, unknown>, type: string): number {
  if (type === "FAQPage") {
    const mainEntity = obj["mainEntity"];
    if (Array.isArray(mainEntity)) return mainEntity.length;
    return mainEntity && typeof mainEntity === "object" && Object.keys(mainEntity).length > 0 ? 1 : 0;
  }

  return Object.entries(obj).reduce(
    (count, [key, value]) => count + (!TRIVIAL_KEYS.has(key) && isFilled(value) ? 1 : 0),
    0,
  );
}

function nestedObjects(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item),
    );
  }
  return value !== null && typeof value === "object"
    ? [value as Record<string, unknown>]
    : [];
}

function hasRatingValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRatingValue);
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (isFilled(item["ratingValue"])) return true;
  return Object.values(item).some(hasRatingValue);
}

function hasBrokenOffer(value: unknown): boolean {
  return nestedObjects(value).some((offer) => isFilled(offer["price"]) && !isFilled(offer["priceCurrency"]));
}

function extractJsonLd(html: string): Array<Record<string, unknown>> {
  const $ = cheerio.load(html);
  const results: Array<Record<string, unknown>> = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html();
      if (!text) return;
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else {
        results.push(parsed);
      }
    } catch {
      // skip invalid JSON-LD
    }
  });

  return results;
}

function extractMicrodata(html: string): string[] {
  const $ = cheerio.load(html);
  const types: string[] = [];
  $("[itemtype]").each((_, el) => {
    const type = $(el).attr("itemtype");
    if (type) {
      const name = type.split("/").pop();
      if (name) types.push(name);
    }
  });
  return types;
}

function getSchemaType(item: Record<string, unknown>): string | null {
  const type = item["@type"];
  if (typeof type === "string") return type;
  if (Array.isArray(type) && type.length > 0) return String(type[0]);
  return null;
}

function flattenGraph(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (item["@graph"] && Array.isArray(item["@graph"])) {
      result.push(...(item["@graph"] as Array<Record<string, unknown>>));
    } else {
      result.push(item);
    }
  }
  return result;
}

export function analyzeSchemaOrg(pages: CrawledPage[]): SchemaOrgResult {
  const allTypes = new Set<string>();
  const allJsonLdItems: Array<Record<string, unknown>> = [];

  for (const page of pages) {
    const jsonLdItems = extractJsonLd(page.html);
    const flattened = flattenGraph(jsonLdItems);
    allJsonLdItems.push(...flattened);

    for (const item of flattened) {
      const type = getSchemaType(item);
      if (type) allTypes.add(type);
    }

    const microdataTypes = extractMicrodata(page.html);
    for (const t of microdataTypes) {
      allTypes.add(t);
    }
  }

  const detectedTypes = Array.from(allTypes);
  const missingHighValue = HIGH_VALUE_TYPES.filter((t) => !allTypes.has(t));

  const productSchemaDetails: Record<string, boolean> = {};
  const productItems = allJsonLdItems.filter((item) => getSchemaType(item) === "Product");

  if (productItems.length > 0) {
    for (const prop of PRODUCT_REQUIRED_PROPS) {
      const hasProperty = productItems.some((item) => {
        const val = item[prop];
        return val !== undefined && val !== null && val !== "";
      });
      productSchemaDetails[prop] = hasProperty;
    }
  }

  const objectsByType = new Map<string, Array<Record<string, unknown>>>();
  for (const item of allJsonLdItems) {
    const type = getSchemaType(item);
    if (!type) continue;
    const items = objectsByType.get(type) ?? [];
    items.push(item);
    objectsByType.set(type, items);
  }

  const validationErrors: string[] = [];
  for (const [type, items] of objectsByType) {
    const hasBrokenRating = items.some(
      (item) =>
        (isFilled(item["aggregateRating"]) && !hasRatingValue(item["aggregateRating"])) ||
        (isFilled(item["review"]) && !hasRatingValue(item["review"])),
    );
    if (hasBrokenRating) {
      validationErrors.push(`${type} schema has aggregateRating or review without ratingValue`);
    }

    const hasPriceWithoutCurrency = items.some(
      (item) =>
        (type === "Offer" && isFilled(item["price"]) && !isFilled(item["priceCurrency"])) ||
        hasBrokenOffer(item["offers"]),
    );
    if (hasPriceWithoutCurrency) {
      validationErrors.push(`${type} schema has price without priceCurrency`);
    }
  }

  const coveredWeight = detectedTypes.reduce((sum, type) => sum + (TYPE_WEIGHTS[type] ?? 0), 0);
  const rawBreadthScore = BREADTH_MAX * Math.min(1, coveredWeight / BREADTH_SATURATION);

  let weightedSubstance = 0;
  const typeBreakdown = detectedTypes
    .filter((type) => (TYPE_WEIGHTS[type] ?? 0) > 0)
    .map((type) => {
      const weight = TYPE_WEIGHTS[type];
      const objects = objectsByType.get(type) ?? [];
      let avgSubstance: number;

      if (STRUCTURAL_TYPES.has(type)) {
        avgSubstance = 1;
      } else if (objects.length === 0) {
        avgSubstance = 0.5;
      } else {
        avgSubstance =
          objects.reduce(
            (sum, object) => sum + (1 - Math.exp(-SUBSTANCE_K * objectSubstance(object, type))),
            0,
          ) / objects.length;
      }

      weightedSubstance += weight * avgSubstance;
      return { type, weight, objectCount: objects.length, avgSubstance };
    });

  const rawSubstanceScore = SUBSTANCE_MAX * Math.min(1, weightedSubstance / SUBSTANCE_SATURATION);
  const correctnessFactor = Math.max(
    MALUS_FLOOR,
    1 - MALUS_PER_HARD_ERROR * validationErrors.length,
  );
  const breadthScore = Math.round(rawBreadthScore * 10) / 10;
  const substanceScore = Math.round(rawSubstanceScore * 10) / 10;
  let score = 0;

  if (detectedTypes.length > 0) {
    score = Math.min(100, Math.max(0, Math.round((rawBreadthScore + rawSubstanceScore) * correctnessFactor)));
  }

  return {
    score,
    detectedTypes,
    missingHighValue,
    productSchemaDetails,
    validationErrors,
    breadthScore: detectedTypes.length === 0 ? 0 : breadthScore,
    substanceScore: detectedTypes.length === 0 ? 0 : substanceScore,
    correctnessFactor: detectedTypes.length === 0 ? 1 : correctnessFactor,
    typeBreakdown,
  };
}
