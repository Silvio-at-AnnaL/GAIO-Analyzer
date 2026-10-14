const scoreKeys = {
  technicalSeo: "technical",
  schemaOrg: "schema",
  headingStructure: "headings",
  contentRelevance: "content",
  faqQuality: "faq",
  llmDiscoverability: "llm",
} as const;

function finiteScore(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

export function readOfferUploadScores(data: Record<string, unknown>) {
  const scores = data.scores && typeof data.scores === "object"
    ? data.scores as Record<string, unknown>
    : {};
  return {
    technicalSeo: finiteScore(scores[scoreKeys.technicalSeo] ?? scores.technicalSeo),
    schemaOrg: finiteScore(scores[scoreKeys.schemaOrg] ?? scores.schemaOrg),
    headingStructure: finiteScore(scores[scoreKeys.headingStructure] ?? scores.headingStructure),
    contentRelevance: finiteScore(scores[scoreKeys.contentRelevance] ?? scores.contentRelevance),
    faqQuality: finiteScore(scores[scoreKeys.faqQuality] ?? scores.faqQuality),
    llmDiscoverability: finiteScore(scores[scoreKeys.llmDiscoverability] ?? scores.llmDiscoverability),
  };
}

export function isFailedUploadReport(data: Record<string, unknown>): boolean {
  return data.status === "failed";
}

interface ExtractedRecommendation {
  tier: string;
  finding: string;
  fix: string;
  hasFixElement: boolean;
}

export function classifyOfferUploadRecommendations(items: ExtractedRecommendation[]) {
  const kritisch: { finding: string; fix: string }[] = [];
  const hoherHebel: { finding: string; fix: string }[] = [];
  const nachgeordnet: { finding: string; fix: string }[] = [];

  for (const item of items) {
    const tier = item.tier.trim().toUpperCase();
    const finding = item.finding.trim();
    const fix = item.fix.trim();
    if (!item.hasFixElement || (!finding && !fix)) continue;
    if (tier.includes("KRITISCH")) kritisch.push({ finding, fix });
    else if (tier.includes("HOHER HEBEL")) hoherHebel.push({ finding, fix });
    else if (tier.includes("NACHGEORDNET") || tier.includes("SEKUNDÄR")) nachgeordnet.push({ finding, fix });
  }

  return { kritisch, hoherHebel, nachgeordnet };
}
