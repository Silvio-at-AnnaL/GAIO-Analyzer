import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";

export interface SchemaOrgResult {
  score: number;
  detectedTypes: string[];
  missingHighValue: string[];
  productSchemaDetails: Record<string, boolean>;
  validationErrors: string[];
}

const HIGH_VALUE_TYPES = ["Organization", "Product", "FAQPage", "BreadcrumbList", "WebPage"];
const PRODUCT_REQUIRED_PROPS = ["name", "description", "offers", "manufacturer", "sku", "image"];

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
  const validationErrors: string[] = [];

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
      if (!hasProperty) {
        validationErrors.push(`Product schema missing required property: ${prop}`);
      }
    }
  }

  if (allTypes.has("Organization")) {
    const orgItems = allJsonLdItems.filter((item) => getSchemaType(item) === "Organization");
    for (const org of orgItems) {
      if (!org["name"]) validationErrors.push("Organization schema missing 'name'");
      if (!org["url"]) validationErrors.push("Organization schema missing 'url'");
    }
  }

  let score = 0;
  const typesFound = detectedTypes.length;
  score += Math.min(30, typesFound * 8);

  const highValueFound = HIGH_VALUE_TYPES.filter((t) => allTypes.has(t)).length;
  score += highValueFound * 12;

  if (productItems.length > 0) {
    const filledProps = Object.values(productSchemaDetails).filter(Boolean).length;
    score += Math.round((filledProps / PRODUCT_REQUIRED_PROPS.length) * 10);
  }

  score -= validationErrors.length * 3;
  score = Math.min(100, Math.max(0, score));

  return {
    score,
    detectedTypes,
    missingHighValue,
    productSchemaDetails,
    validationErrors,
  };
}
