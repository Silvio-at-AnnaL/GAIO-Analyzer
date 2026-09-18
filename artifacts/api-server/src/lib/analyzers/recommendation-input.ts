export const MAX_INPUT_CHARS = 30_000;

const HEADER = 'VERBINDLICHE MESSWERTE DER ANALYSE (vollständig, alle Module enthalten). Leite Befunde ausschließlich aus diesen Daten ab. Behaupte nie, etwas fehle, wenn die Daten es als vorhanden ausweisen. Module mit status "nicht_verfuegbar" wurden nicht gemessen – daraus keine Befunde ableiten.';
const MODULE_KEYS = [
  "crawl",
  "technicalSeo",
  "schemaOrg",
  "headingStructure",
  "contentRelevance",
  "faqQuality",
  "llmDiscoverability",
] as const;

type ModuleStatus = Record<string, "ok" | "missing">;
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown, maxLength?: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return maxLength === undefined ? value : value.slice(0, maxLength);
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function defined<T extends UnknownRecord>(value: T): UnknownRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function rounded(value: unknown): number | undefined {
  const numeric = number(value);
  return numeric === undefined ? undefined : Math.round(numeric * 10) / 10;
}

function unavailable(): { status: "nicht_verfuegbar" } {
  return { status: "nicht_verfuegbar" };
}

function buildCompactModules(
  moduleResults: Record<string, unknown>,
  trimLevel: number,
): { data: UnknownRecord; modules: ModuleStatus } {
  const modules: ModuleStatus = {};

  const crawlSource = record(moduleResults.crawlReliability);
  const languageVariants = [...new Set(
    array(moduleResults.languageVariants).flatMap((item) => {
      const lang = string(record(item)?.lang);
      return lang ? [lang] : [];
    }),
  )];
  modules.crawl = crawlSource ? "ok" : "missing";
  const crawl = crawlSource
    ? defined({
        pagesAttempted: number(crawlSource.attempted),
        pagesSucceeded: number(crawlSource.succeeded),
        pagesFailed: number(crawlSource.failed),
        languageVariants,
      })
    : { ...unavailable(), languageVariants };

  const technicalSource = record(moduleResults.technicalSeo);
  modules.technicalSeo = technicalSource ? "ok" : "missing";
  let technicalSeo: UnknownRecord = unavailable();
  if (technicalSource) {
    const robotsSource = record(technicalSource.robotsTxtAnalysis);
    const sitemapSource = record(technicalSource.sitemapXmlAnalysis);
    const llmsSource = record(technicalSource.llmsTxtAnalysis);
    const llmCrawlers = robotsSource
      ? array(robotsSource.llmCrawlers).flatMap((item) => {
          const crawler = record(item);
          if (!crawler) return [];
          const name = string(crawler.name);
          const status = string(crawler.status);
          return name && status ? [{ name, status }] : [];
        })
      : [];

    technicalSeo = defined({
      score: number(technicalSource.score),
      httpsEnforced: boolean(technicalSource.httpsEnforced),
      mobileViewport: boolean(technicalSource.mobileViewport),
      responseTimeMs: number(technicalSource.responseTime),
      ttfbMs: number(technicalSource.ttfb),
      canonicalTags: record(technicalSource.canonicalTags) ?? undefined,
      hreflang: record(technicalSource.hreflang) ?? undefined,
      metaTitles: record(technicalSource.metaTitles) ?? undefined,
      metaDescriptions: record(technicalSource.metaDescriptions) ?? undefined,
      imageAltCoverage: number(technicalSource.imageAltCoverage),
      robotsTxt: boolean(technicalSource.robotsTxt),
      sitemapXml: boolean(technicalSource.sitemapXml),
      sitemapType: string(technicalSource.sitemapType),
      llmsTxt: boolean(technicalSource.llmsTxt),
      robots: robotsSource
        ? defined({
            summary: string(robotsSource.summary),
            llmCrawlers,
            siteBlockedAgents: array(robotsSource.siteBlockedAgents).filter((item): item is string => typeof item === "string"),
          })
        : null,
      sitemap: sitemapSource
        ? defined({
            summary: string(sitemapSource.summary),
            totalUrls: number(sitemapSource.totalUrls),
            crawledPageCoverage: number(sitemapSource.crawledPageCoverage),
          })
        : null,
      llmsTxtInfo: llmsSource
        ? defined({
            present: boolean(llmsSource.present),
            hasDescription: boolean(llmsSource.hasDescription),
            linkedPageCount: number(llmsSource.linkedPageCount),
            sectionCount: array(llmsSource.sections).length,
            summary: string(llmsSource.summary),
          })
        : unavailable(),
    });
  }

  const schemaSource = record(moduleResults.schemaOrg);
  modules.schemaOrg = schemaSource ? "ok" : "missing";
  const validationLimit = trimLevel >= 4 ? 2 : 5;
  const schemaOrg = schemaSource
    ? defined({
        score: number(schemaSource.score),
        detectedTypes: array(schemaSource.detectedTypes).filter((item): item is string => typeof item === "string"),
        missingHighValue: array(schemaSource.missingHighValue).filter((item): item is string => typeof item === "string"),
        typeBreakdown: array(schemaSource.typeBreakdown).flatMap((item) => {
          const breakdown = record(item);
          if (!breakdown) return [];
          return [defined({
            type: string(breakdown.type),
            objectCount: number(breakdown.objectCount),
            substancePercent: rounded(
              number(breakdown.avgSubstance) === undefined
                ? undefined
                : (number(breakdown.avgSubstance) as number) * 100,
            ),
          })];
        }),
        breadthScore: number(schemaSource.breadthScore),
        substanceScore: number(schemaSource.substanceScore),
        correctnessFactor: number(schemaSource.correctnessFactor),
        productSchemaDetails: record(schemaSource.productSchemaDetails) ?? undefined,
        validationErrors: array(schemaSource.validationErrors)
          .filter((item): item is string => typeof item === "string")
          .slice(0, validationLimit)
          .map((item) => item.slice(0, 200)),
      })
    : unavailable();

  const headingSource = record(moduleResults.headingStructure);
  modules.headingStructure = headingSource ? "ok" : "missing";
  const headingPages = headingSource ? array(headingSource.pages).flatMap((item) => {
    const page = record(item);
    return page ? [page] : [];
  }) : [];
  const scoredHeadingPages = headingPages.filter((page) => page.excludedAsLegal !== true);
  const problemLimit = trimLevel >= 4 ? 5 : 10;
  const breakdownSource = headingSource ? record(headingSource.breakdown) : null;
  const headingBreakdown = breakdownSource
    ? Object.fromEntries(["h1", "hierarchy", "structure", "quality"].flatMap((key) => {
        const component = record(breakdownSource[key]);
        return component
          ? [[key, defined({ points: rounded(component.points), weight: rounded(component.weight) })]]
          : [];
      }))
    : undefined;
  const problemPages = scoredHeadingPages.flatMap((page) => {
    const reasons: string[] = [];
    const h1Count = number(page.h1Count);
    if (h1Count === 0) reasons.push("keine H1");
    if (h1Count !== undefined && h1Count > 1) reasons.push("mehrere H1");
    if (page.hierarchyIssue === "h1_not_first") reasons.push("H1 nicht erste Inhaltsüberschrift");
    if (page.hierarchyIssue === "level_skip") reasons.push("Ebene übersprungen");
    if (page.duplicateH1 === true) reasons.push("H1 doppelt");
    const url = string(page.url);
    return url && reasons.length > 0 ? [{ url, reasons }] : [];
  }).slice(0, problemLimit);
  const pageOutlines = trimLevel >= 1
    ? undefined
    : [...scoredHeadingPages, ...headingPages.filter((page) => page.excludedAsLegal === true)]
      .flatMap((page) => {
        const url = string(page.url);
        const firstH1 = array(page.headings).find((item) => record(item)?.level === "h1");
        const h1 = string(record(firstH1)?.text, 120) ?? null;
        const h2 = array(page.headings).flatMap((item) => {
          const heading = record(item);
          if (!heading || heading.level !== "h2" || heading.inTemplate === true) return [];
          const text = string(heading.text, 80);
          return text ? [text] : [];
        }).slice(0, 5);
        return url ? [{ url, h1, h2 }] : [];
      }).slice(0, 13);
  const headingStructure = headingSource
    ? defined({
        score: number(headingSource.score),
        pagesAnalysed: headingPages.length,
        scoredPageCount: number(headingSource.scoredPageCount) ?? scoredHeadingPages.length,
        breakdown: headingBreakdown,
        pagesWithoutH1: scoredHeadingPages.filter((page) => number(page.h1Count) === 0).length,
        pagesWithMultipleH1: scoredHeadingPages.filter((page) => (number(page.h1Count) ?? 0) > 1).length,
        pagesWithHierarchyIssues: scoredHeadingPages.filter((page) => page.hasHierarchyIssues === true).length,
        problemPages,
        pageOutlines,
        keywordInHeadings: boolean(headingSource.keywordInHeadings),
      })
    : unavailable();

  const contentSource = record(moduleResults.contentRelevance);
  modules.contentRelevance = contentSource ? "ok" : "missing";
  const findingLimit = trimLevel >= 3 ? 2 : 4;
  const contentRelevance = contentSource
    ? defined({
        score: number(contentSource.score),
        dimensions: array(contentSource.dimensions).flatMap((item) => {
          const dimension = record(item);
          if (!dimension) return [];
          return [defined({
            name: string(dimension.name),
            score: number(dimension.score),
            findings: array(dimension.findings)
              .filter((finding): finding is string => typeof finding === "string")
              .slice(0, findingLimit)
              .map((finding) => finding.slice(0, 300)),
          })];
        }),
      })
    : unavailable();

  const faqSource = record(moduleResults.faqQuality);
  modules.faqQuality = faqSource ? "ok" : "missing";
  const faqQuality = faqSource
    ? defined({
        score: number(faqSource.score),
        hasFaqSchema: boolean(faqSource.hasFaqSchema),
        hasHtmlFaq: boolean(faqSource.hasHtmlFaq),
        faqItemsFound: number(faqSource.faqItemsFound),
        qualityAssessment: faqSource.qualityAssessment === null
          ? null
          : string(faqSource.qualityAssessment, trimLevel >= 3 ? 400 : 800),
      })
    : unavailable();

  const llmSource = record(moduleResults.llmDiscoverability);
  modules.llmDiscoverability = llmSource ? "ok" : "missing";
  const questionLimit = trimLevel >= 2 ? 6 : 12;
  const compactPart = (value: unknown): UnknownRecord | undefined => {
    const part = record(value);
    return part
      ? defined({
          label: string(part.label),
          score: number(part.score),
          avgRating: number(part.avgRating),
        })
      : undefined;
  };
  const questions = llmSource
    ? array(llmSource.questions).flatMap((item) => {
        const question = record(item);
        if (!question) return [];
        return [defined({
          question: string(question.question, 200),
          rating: number(question.rating),
          gap: string(question.gap, 250),
          sourceUrl: question.sourceUrl === null ? null : string(question.sourceUrl),
        })];
      }).sort((a, b) => (number(a.rating) ?? Infinity) - (number(b.rating) ?? Infinity)).slice(0, questionLimit)
    : [];
  const llmDiscoverability = llmSource
    ? defined({
        score: number(llmSource.score),
        avgRating: number(llmSource.avgRating),
        partA: compactPart(llmSource.partA),
        partB: compactPart(llmSource.partB),
        questions,
      })
    : unavailable();

  const data = {
    crawl,
    technicalSeo,
    schemaOrg,
    headingStructure,
    contentRelevance,
    faqQuality,
    llmDiscoverability,
  };
  for (const key of MODULE_KEYS) {
    if (!(key in modules)) modules[key] = "missing";
  }
  return { data, modules };
}

export function buildRecommendationInput(
  moduleResults: Record<string, unknown>,
): { text: string; size: number; languageVariantsChars: number; modules: ModuleStatus; trimLevel: number } {
  let trimLevel = 0;
  let built = buildCompactModules(moduleResults, trimLevel);
  let text = `${HEADER}\n${JSON.stringify(built.data)}`;

  while (text.length > MAX_INPUT_CHARS && trimLevel < 4) {
    trimLevel++;
    built = buildCompactModules(moduleResults, trimLevel);
    text = `${HEADER}\n${JSON.stringify(built.data)}`;
  }

  const crawl = record(built.data.crawl);
  const languageVariantsChars = JSON.stringify(crawl?.languageVariants ?? []).length;
  return { text, size: text.length, languageVariantsChars, modules: built.modules, trimLevel };
}