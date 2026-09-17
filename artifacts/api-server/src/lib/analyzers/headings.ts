import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";

interface HeadingItem {
  level: string;
  text: string;
  inTemplate: boolean;
}

interface PageHeadingResult {
  url: string;
  h1Count: number;
  hasHierarchyIssues: boolean;
  hierarchyIssue: "h1_not_first" | "level_skip" | null;
  excludedAsLegal: boolean;
  h2Count: number;
  descriptiveShare: number;
  duplicateH1: boolean;
  headings: HeadingItem[];
}

export interface HeadingScoreParams {
  weight_h1: number;
  weight_hierarchy: number;
  weight_structure: number;
  weight_quality: number;
  multi_h1_credit: number;
  min_h2_for_structure: number;
  quality_min_words: number;
  quality_min_chars: number;
  duplicate_h1_factor: number;
}

export const DEFAULT_HEADING_PARAMS: HeadingScoreParams = {
  weight_h1: 35,
  weight_hierarchy: 25,
  weight_structure: 20,
  weight_quality: 20,
  multi_h1_credit: 0.5,
  min_h2_for_structure: 2,
  quality_min_words: 3,
  quality_min_chars: 15,
  duplicate_h1_factor: 0.5,
};

type ComponentName = "h1" | "hierarchy" | "structure" | "quality";

interface HeadingComponent {
  avg: number;
  weight: number;
  points: number;
}

export interface HeadingResult {
  score: number;
  pages: PageHeadingResult[];
  keywordInHeadings: boolean;
  scoredPageCount: number;
  breakdown: Record<ComponentName, HeadingComponent>;
  params: HeadingScoreParams;
}

const LEGAL_PATH = /impressum|datenschutz|privacy|agb|terms|cookie|legal|disclaimer|imprint|widerruf/i;
const TEMPLATE_SELECTOR = "header, nav, footer, aside";
const GENERIC_HEADINGS = new Set([
  "home", "startseite", "willkommen", "welcome", "mehr erfahren", "weiterlesen", "read more",
  "kontakt", "contact", "news", "aktuelles", "menü", "menu", "navigation", "suche", "search",
  "newsletter", "unternehmen", "produkte", "leistungen", "service", "über uns", "about us",
]);

function pathnameIsLegal(url: string): boolean {
  try {
    return LEGAL_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function analyzeHeadings(
  pages: CrawledPage[],
  brandTerms: string[] = [],
  params: HeadingScoreParams = DEFAULT_HEADING_PARAMS,
): HeadingResult {
  const extractedPages: Array<{
    url: string;
    headings: HeadingItem[];
    contentHeadings: HeadingItem[];
    h1Count: number;
    firstH1: string | null;
    hierarchyIssue: "h1_not_first" | "level_skip" | null;
    excludedAsLegal: boolean;
    h2Count: number;
    descriptiveShare: number;
  }> = [];
  let keywordFound = false;

  const lowerTerms = brandTerms.map((t) => t.toLowerCase()).filter((t) => t.length > 1);

  for (const page of pages) {
    const $ = cheerio.load(page.html);
    const headings: HeadingItem[] = [];

    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const tag = (el as { tagName?: string }).tagName?.toLowerCase() || "";
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text) {
        headings.push({
          level: tag,
          text,
          inTemplate: $(el).parents(TEMPLATE_SELECTOR).length > 0,
        });
      }
    });

    const h1Count = headings.filter((h) => h.level === "h1").length;
    const contentHeadings = headings.filter((heading) => !heading.inTemplate || heading.level === "h1");
    let hierarchyIssue: "h1_not_first" | "level_skip" | null = null;
    if (contentHeadings.length > 0) {
      if (h1Count >= 1 && contentHeadings[0].level !== "h1") {
        hierarchyIssue = "h1_not_first";
      } else {
        for (let index = 1; index < contentHeadings.length; index++) {
          const previousLevel = Number(contentHeadings[index - 1].level.slice(1));
          const currentLevel = Number(contentHeadings[index].level.slice(1));
          if (currentLevel > previousLevel + 1) {
            hierarchyIssue = "level_skip";
            break;
          }
        }
      }
    }
    const h2Count = contentHeadings.filter((heading) => heading.level === "h2").length;
    const qualityCandidates = contentHeadings.filter((heading) => heading.level === "h1" || heading.level === "h2");
    const descriptiveCount = qualityCandidates.filter((heading) => {
      const normalized = heading.text.toLowerCase().trim();
      return heading.text.split(/\s+/).length >= params.quality_min_words
        && heading.text.length >= params.quality_min_chars
        && !GENERIC_HEADINGS.has(normalized);
    }).length;
    const descriptiveShare = qualityCandidates.length > 0
      ? descriptiveCount / qualityCandidates.length
      : 0;

    if (lowerTerms.length > 0) {
      for (const h of headings) {
        if (h.level === "h1" || h.level === "h2") {
          const lowerText = h.text.toLowerCase();
          for (const term of lowerTerms) {
            if (lowerText.includes(term)) {
              keywordFound = true;
              break;
            }
          }
        }
        if (keywordFound) break;
      }
    }

    extractedPages.push({
      url: page.url,
      h1Count,
      firstH1: headings.find((heading) => heading.level === "h1")?.text ?? null,
      headings,
      contentHeadings,
      hierarchyIssue,
      excludedAsLegal: pathnameIsLegal(page.url),
      h2Count,
      descriptiveShare,
    });
  }

  let scoredPages = extractedPages.filter((page) => !page.excludedAsLegal);
  if (scoredPages.length === 0) {
    scoredPages = extractedPages;
  }

  const firstH1Counts = new Map<string, number>();
  for (const page of scoredPages) {
    if (!page.firstH1) continue;
    const normalized = page.firstH1.toLowerCase();
    firstH1Counts.set(normalized, (firstH1Counts.get(normalized) ?? 0) + 1);
  }

  const duplicateH1Pages = new Set(
    scoredPages.filter((page) =>
      page.firstH1 !== null
      && (firstH1Counts.get(page.firstH1.toLowerCase()) ?? 0) > 1,
    ),
  );
  const pageResults: PageHeadingResult[] = extractedPages.map((page) => {
    return {
      url: page.url,
      h1Count: page.h1Count,
      hasHierarchyIssues: page.hierarchyIssue !== null,
      hierarchyIssue: page.hierarchyIssue,
      excludedAsLegal: page.excludedAsLegal,
      h2Count: page.h2Count,
      descriptiveShare: roundTo(page.descriptiveShare, 2),
      duplicateH1: duplicateH1Pages.has(page),
      headings: page.headings.slice(0, 20),
    };
  });

  const componentValues: Record<ComponentName, number[]> = {
    h1: [],
    hierarchy: [],
    structure: [],
    quality: [],
  };
  for (const page of scoredPages) {
    const hasAnyHeadings = page.headings.length > 0;
    componentValues.h1.push(!hasAnyHeadings ? 0 : page.h1Count === 1 ? 1 : page.h1Count > 1 ? params.multi_h1_credit : 0);
    componentValues.hierarchy.push(page.contentHeadings.length > 0 && page.hierarchyIssue === null ? 1 : 0);
    componentValues.structure.push(hasAnyHeadings && page.h2Count >= params.min_h2_for_structure ? 1 : 0);
    componentValues.quality.push(hasAnyHeadings
      ? page.descriptiveShare * (duplicateH1Pages.has(page) ? params.duplicate_h1_factor : 1)
      : 0);
  }

  const weights: Record<ComponentName, number> = {
    h1: params.weight_h1,
    hierarchy: params.weight_hierarchy,
    structure: params.weight_structure,
    quality: params.weight_quality,
  };
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const breakdown = Object.fromEntries(
    (Object.keys(weights) as ComponentName[]).map((name) => {
      const values = componentValues[name];
      const avg = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      const points = totalWeight > 0 ? roundTo((avg * weights[name] / totalWeight) * 100, 1) : 0;
      return [name, { avg, weight: weights[name], points }];
    }),
  ) as Record<ComponentName, HeadingComponent>;
  const score = totalWeight > 0
    ? Math.min(100, Math.max(0, Math.round(
        (Object.keys(weights) as ComponentName[])
          .reduce((sum, name) => sum + breakdown[name].avg * weights[name], 0)
          / totalWeight
          * 100,
      )))
    : 0;

  return {
    score,
    pages: pageResults,
    keywordInHeadings: keywordFound,
    scoredPageCount: scoredPages.length,
    breakdown,
    params,
  };
}
