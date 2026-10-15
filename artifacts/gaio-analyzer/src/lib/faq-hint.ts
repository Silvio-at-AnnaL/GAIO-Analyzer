import type { TechnicalT } from "./technical-breakdown";

export function faqNoSchemaHint(faq: Record<string, unknown>, t: TechnicalT): string | null {
  if (typeof faq.visiblePairCount !== "number" || faq.visiblePairCount <= 0 || faq.hasFaqSchema !== false) return null;
  const breakdown = faq.breakdown as { schema?: { max?: unknown } } | null | undefined;
  const points = breakdown?.schema?.max;
  // Older reports without a schema maximum must not invent a score deduction.
  if (typeof points !== "number") return null;
  return t("results.faq_no_schema_hint", { points });
}
