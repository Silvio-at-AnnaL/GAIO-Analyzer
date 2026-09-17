export type HeadingSummary = {
  totalPages: number;
  scoredPages: number;
  legalPages: number;
  pagesWithSingleH1: number;
  pagesWithoutH1: number;
  pagesWithMultipleH1: number;
  pagesWithHierarchyIssues: number;
  breakdown: Array<{
    key: "h1" | "hierarchy" | "structure" | "quality";
    points: number;
    maxPoints: number;
    avg: number;
  }> | null;
  problemPages: Array<{
    url: string;
    h1Count: number;
    hasHierarchyIssues: boolean;
    hierarchyIssue: "h1_not_first" | "level_skip" | undefined;
    duplicateH1: boolean;
    reasons: string[];
  }>;
};

const BREAKDOWN_KEYS = ["h1", "hierarchy", "structure", "quality"] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getHeadingSummary(headingStructure: unknown): HeadingSummary | null {
  if (
    typeof headingStructure !== "object"
    || headingStructure === null
    || !Array.isArray((headingStructure as { pages?: unknown }).pages)
  ) {
    return null;
  }

  const pages = (headingStructure as { pages: unknown[] }).pages.flatMap((page) => {
    if (
      typeof page !== "object"
      || page === null
      || typeof (page as { url?: unknown }).url !== "string"
      || typeof (page as { h1Count?: unknown }).h1Count !== "number"
    ) {
      return [];
    }

    return [{
      url: (page as { url: string }).url,
      h1Count: (page as { h1Count: number }).h1Count,
      hasHierarchyIssues: (page as { hasHierarchyIssues?: unknown }).hasHierarchyIssues === true,
      hierarchyIssue: (
        (page as { hierarchyIssue?: unknown }).hierarchyIssue === "h1_not_first"
        || (page as { hierarchyIssue?: unknown }).hierarchyIssue === "level_skip"
      )
        ? (page as { hierarchyIssue: "h1_not_first" | "level_skip" }).hierarchyIssue
        : undefined,
      excludedAsLegal: (page as { excludedAsLegal?: unknown }).excludedAsLegal === true,
      duplicateH1: (page as { duplicateH1?: unknown }).duplicateH1 === true,
    }];
  });

  const nonLegalPages = pages.filter((page) => !page.excludedAsLegal);
  const scoredPages = nonLegalPages.length > 0 ? nonLegalPages : pages;
  const rawBreakdown = (headingStructure as { breakdown?: unknown }).breakdown;
  let breakdown: HeadingSummary["breakdown"] = null;
  if (typeof rawBreakdown === "object" && rawBreakdown !== null) {
    const components = BREAKDOWN_KEYS.map((key) => {
      const component = (rawBreakdown as Record<string, unknown>)[key];
      if (typeof component !== "object" || component === null) return null;
      const { avg, weight, points } = component as Record<string, unknown>;
      return isFiniteNumber(avg) && isFiniteNumber(weight) && isFiniteNumber(points)
        ? { key, avg, weight, points }
        : null;
    });
    if (components.every((component) => component !== null)) {
      const validComponents = components as Array<{
        key: typeof BREAKDOWN_KEYS[number];
        avg: number;
        weight: number;
        points: number;
      }>;
      const weightSum = validComponents.reduce((sum, component) => sum + component.weight, 0);
      if (weightSum !== 0) {
        breakdown = validComponents.map(({ key, avg, weight, points }) => ({
          key,
          avg,
          points: Math.round(points * 10) / 10,
          maxPoints: Math.round((weight / weightSum) * 1000) / 10,
        }));
      }
    }
  }

  const problemPages = scoredPages
    .filter((page) => page.h1Count !== 1 || page.hasHierarchyIssues || page.duplicateH1)
    .map((page) => {
      const reasons = [
        page.h1Count === 0 ? "no_h1" : null,
        page.h1Count > 1 ? "multi_h1" : null,
        page.hierarchyIssue === "h1_not_first" ? "h1_not_first" : null,
        page.hierarchyIssue === "level_skip" ? "level_skip" : null,
        page.hierarchyIssue === undefined && page.hasHierarchyIssues ? "legacy_hierarchy" : null,
        page.duplicateH1 ? "duplicate_h1" : null,
      ].filter((reason): reason is string => reason !== null);
      return {
        url: page.url,
        h1Count: page.h1Count,
        hasHierarchyIssues: page.hasHierarchyIssues,
        hierarchyIssue: page.hierarchyIssue,
        duplicateH1: page.duplicateH1,
        reasons,
      };
    });

  return {
    totalPages: pages.length,
    scoredPages: scoredPages.length,
    legalPages: pages.filter((page) => page.excludedAsLegal).length,
    pagesWithSingleH1: scoredPages.filter((page) => page.h1Count === 1).length,
    pagesWithoutH1: scoredPages.filter((page) => page.h1Count === 0).length,
    pagesWithMultipleH1: scoredPages.filter((page) => page.h1Count > 1).length,
    pagesWithHierarchyIssues: scoredPages.filter((page) => page.hasHierarchyIssues).length,
    breakdown,
    problemPages,
  };
}