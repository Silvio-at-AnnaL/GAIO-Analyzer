import { anthropic } from "@workspace/integrations-anthropic-ai";
import { crawlSite } from "../crawler";
import { analyzeTechnicalSeo } from "./technical-seo";
import { analyzeSchemaOrg, type SchemaScoreParams } from "./schema-org";
import { analyzeHeadings, type HeadingScoreParams } from "./headings";
import { analyzeFaq, type FaqScoreParams } from "./faq";
import { analyzeContentRelevance, extractPageText } from "./content-relevance";
import { getPrompt, fillTemplate } from "../prompt-manager.js";
import { logger } from "../logger";
import { getScoreParams } from "../score-config.js";
import { getTitleFromHtml } from "../html-title";

export interface CompetitorFindings {
  betterThanYou: string;
  yourAdvantage: string;
  recommendation: string;
}

export interface CompetitorCrawledPage {
  url: string;
  title: string | null;
}

export interface CompetitorScore {
  name: string;
  url: string;
  technicalScore: number;
  schemaScore: number;
  contentScore: number | null;
  headingScore: number;
  faqScore: number;
  compositeScore: number;
  crawledPagesCount: number;
  crawledPages: CompetitorCrawledPage[];
  findings: CompetitorFindings | null;
  error?: string;
  errorReason?: "unreachable" | "bot_protection" | "parked_domain" | "js_rendered";
}

export interface CompetitorResult {
  competitors: CompetitorScore[];
  mainComparisonScore: number;
}

export interface MainSiteScores {
  technicalScore: number;
  schemaScore: number;
  contentScore: number;
  headingScore: number;
  faqScore: number;
  overallScore: number;
}

const MAX_COMPETITORS = 5;
const COMPETITOR_MAX_PAGES = 5;
const CRAWL_DEADLINE_MS = 45_000;
const FINDINGS_TIMEOUT_MS = 30_000;
const CONTENT_TIMEOUT_MS = 60_000;
const MIN_VISIBLE_TEXT_CHARS = 500;

type ComparisonScores = Pick<
  CompetitorScore,
  "technicalScore" | "schemaScore" | "contentScore" | "headingScore" | "faqScore"
>;

type ComparisonArea = {
  label: string;
  main: number;
  competitor: number;
  diff: number;
};

function calculateComparisonScore(scores: ComparisonScores): number {
  const weightedScores = [
    { score: scores.schemaScore, weight: 0.20 },
    { score: scores.contentScore, weight: 0.20 },
    { score: scores.technicalScore, weight: 0.15 },
    { score: scores.faqScore, weight: 0.15 },
    { score: scores.headingScore, weight: 0.10 },
  ].filter((entry): entry is { score: number; weight: number } => entry.score !== null);
  const weightedSum = weightedScores.reduce((sum, entry) => sum + entry.score * entry.weight, 0);
  const weightSum = weightedScores.reduce((sum, entry) => sum + entry.weight, 0);
  return weightSum > 0 ? Math.round(weightedSum / weightSum) : 0;
}

function getComparisonAreas(
  mainScores: MainSiteScores,
  competitorScores: ComparisonScores,
): ComparisonArea[] {
  const areas: Array<{ label: string; main: number | null; competitor: number | null }> = [
    { label: "Technisches SEO", main: mainScores.technicalScore, competitor: competitorScores.technicalScore },
    { label: "Schema.org", main: mainScores.schemaScore, competitor: competitorScores.schemaScore },
    { label: "Inhaltliche Relevanz", main: mainScores.contentScore, competitor: competitorScores.contentScore },
    { label: "Heading-Struktur", main: mainScores.headingScore, competitor: competitorScores.headingScore },
    { label: "FAQ", main: mainScores.faqScore, competitor: competitorScores.faqScore },
  ];
  return areas.flatMap((area) => {
    if (area.main === null || area.competitor === null) return [];
    return [{ ...area, main: area.main, competitor: area.competitor, diff: area.main - area.competitor }];
  });
}

function buildComparisonAreas(
  mainScores: MainSiteScores,
  competitorScores: ComparisonScores,
): { advantages: string; disadvantages: string } {
  const advantages: string[] = [];
  const disadvantages: string[] = [];
  for (const area of getComparisonAreas(mainScores, competitorScores)) {
    const line = `${area.label}: Ihre Website ${area.main}, Wettbewerber ${area.competitor}`;
    if (area.diff >= 5) advantages.push(line);
    if (area.diff <= -5) disadvantages.push(line);
  }
  return {
    advantages: advantages.length > 0 ? advantages.join("\n") : "keine",
    disadvantages: disadvantages.length > 0 ? disadvantages.join("\n") : "keine",
  };
}

export function buildCompetitorFindingsFallback(
  mainScores: MainSiteScores,
  competitorScores: ComparisonScores,
): CompetitorFindings {
  const areas = getComparisonAreas(mainScores, competitorScores);
  const largestAdvantage = areas
    .filter((area) => area.diff >= 5)
    .sort((a, b) => b.diff - a.diff)[0];
  const largestDisadvantage = areas
    .filter((area) => area.diff <= -5)
    .sort((a, b) => a.diff - b.diff)[0];
  const strongestArea = largestAdvantage ?? areas.slice().sort((a, b) => b.diff - a.diff)[0];

  return {
    betterThanYou: largestDisadvantage
      ? `${largestDisadvantage.label}: Wettbewerber ${largestDisadvantage.competitor} Punkte, Ihre Website ${largestDisadvantage.main} Punkte.`
      : "Dieser Wettbewerber liegt in keinem der verglichenen Bereiche deutlich vor Ihrer Website.",
    yourAdvantage: largestAdvantage
      ? `${largestAdvantage.label}: Ihre Website ${largestAdvantage.main} Punkte, Wettbewerber ${largestAdvantage.competitor} Punkte.`
      : "In keinem der verglichenen Bereiche liegt Ihre Website deutlich vorn.",
    recommendation: largestDisadvantage
      ? `Schließen Sie den Rückstand im Bereich ${largestDisadvantage.label} (${largestDisadvantage.main} gegenüber ${largestDisadvantage.competitor} Punkten).`
      : strongestArea
        ? `Bauen Sie Ihren Vorsprung im Bereich ${strongestArea.label} weiter aus.`
        : "Stärken Sie die vorhandenen Inhalte und technischen Grundlagen weiter.",
  };
}

function extractDomainName(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractPageTitle(html: string): string | null {
  return getTitleFromHtml(html) || null;
}

async function generateFindings(
  mainDomain: string,
  mainScores: MainSiteScores,
  competitorDomain: string,
  competitorScores: {
    technicalScore: number;
    schemaScore: number;
    contentScore: number | null;
    headingScore: number;
    faqScore: number;
    compositeScore: number;
  },
  advantages: string,
  disadvantages: string,
): Promise<CompetitorFindings> {
  const startedAt = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const prompt = fillTemplate(await getPrompt("competitor-analysis"), {
      MAIN_DOMAIN: mainDomain,
      MAIN_TECH: String(mainScores.technicalScore),
      MAIN_SCHEMA: String(mainScores.schemaScore),
      MAIN_CONTENT: String(mainScores.contentScore),
      MAIN_HEADINGS: String(mainScores.headingScore),
      MAIN_FAQ: String(mainScores.faqScore),
      COMP_DOMAIN: competitorDomain,
      COMP_TECH: String(competitorScores.technicalScore),
      COMP_SCHEMA: String(competitorScores.schemaScore),
      COMP_CONTENT: competitorScores.contentScore === null ? "—" : String(competitorScores.contentScore),
      COMP_HEADINGS: String(competitorScores.headingScore),
      COMP_FAQ: String(competitorScores.faqScore),
      COMP_COMPOSITE: String(competitorScores.compositeScore),
      ADVANTAGES: advantages,
      DISADVANTAGES: disadvantages,
    });
    const response = await Promise.race([
      anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("timeout")), FINDINGS_TIMEOUT_MS);
      }),
    ]);

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("invalid JSON object");
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as Partial<CompetitorFindings>;
    if (
      typeof parsed.betterThanYou !== "string" || parsed.betterThanYou.trim() === "" ||
      typeof parsed.yourAdvantage !== "string" || parsed.yourAdvantage.trim() === "" ||
      typeof parsed.recommendation !== "string" || parsed.recommendation.trim() === ""
    ) {
      throw new Error("invalid findings fields");
    }
    return {
      betterThanYou: parsed.betterThanYou,
      yourAdvantage: parsed.yourAdvantage,
      recommendation: parsed.recommendation,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      { competitorDomain, reason, durationMs: Date.now() - startedAt },
      "Failed to generate competitor findings — using deterministic fallback",
    );
    return buildCompetitorFindingsFallback(mainScores, competitorScores);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function analyzeCompetitors(
  competitorUrls: string[],
  mainSiteScores: MainSiteScores,
  questionnaireContext: string,
  mainSiteLang: string | null,
): Promise<CompetitorResult> {
  const urlsToProcess = competitorUrls.slice(0, MAX_COMPETITORS);
  const [schemaParams, headingParams, faqParams] = await Promise.all([
    getScoreParams("schema-org"),
    getScoreParams("headings"),
    getScoreParams("faq"),
  ]);
  const mainComparisonScore = calculateComparisonScore({
    technicalScore: mainSiteScores.technicalScore,
    schemaScore: mainSiteScores.schemaScore,
    contentScore: mainSiteScores.contentScore,
    headingScore: mainSiteScores.headingScore,
    faqScore: mainSiteScores.faqScore,
  });

  // Competitor scoring is a sample; cap the work so this module cannot grow
  // without bound when many URLs are submitted.
  const competitors = await Promise.all(urlsToProcess.map(async (url): Promise<CompetitorScore> => {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    const competitorDomain = extractDomainName(normalizedUrl);

    try {
      // B2: Crawl at least 3 pages (homepage + 2 subpages); use 5 to allow
      //     priority scoring to select the best subpages.
      const crawlStartedAt = Date.now();
      const crawlResult = await crawlSite(normalizedUrl, COMPETITOR_MAX_PAGES, { deadlineMs: CRAWL_DEADLINE_MS, preferredLang: mainSiteLang ?? undefined });

      if (crawlResult.pages.length === 0) {
        const errorReason = crawlResult.homepageFailReason === "bot_protection" ||
          crawlResult.homepageFailReason === "parked_domain"
          ? crawlResult.homepageFailReason
          : "unreachable";
        logger.warn(
          {
            competitorDomain,
            homepageFailReason: crawlResult.homepageFailReason,
            durationMs: Date.now() - crawlStartedAt,
          },
          "Competitor crawl returned no pages — including with zero scores",
        );
        return {
          name: competitorDomain,
          url: normalizedUrl,
          technicalScore: 0,
          schemaScore: 0,
          contentScore: 0,
          headingScore: 0,
          faqScore: 0,
          compositeScore: 0,
          crawledPagesCount: 0,
          crawledPages: [],
          findings: null,
          error: "Nicht erreichbar",
          errorReason,
        };
      }

      if (crawlResult.timedOut || crawlResult.pages.length < COMPETITOR_MAX_PAGES) {
        logger.warn(
          {
            competitorDomain,
            pages: crawlResult.pages.length,
            requested: COMPETITOR_MAX_PAGES,
            timedOut: crawlResult.timedOut,
            attempted: crawlResult.reliability.attempted,
            succeeded: crawlResult.reliability.succeeded,
            failed: crawlResult.reliability.failed,
            skippedOtherLanguage: crawlResult.skipped.otherLanguage,
            skippedExcludedPath: crawlResult.skipped.excludedPath,
            skippedDuplicate: crawlResult.skipped.duplicate,
            durationMs: Date.now() - crawlStartedAt,
          },
          "Competitor crawl returned fewer pages than requested",
        );
      }

      const crawledPages: CompetitorCrawledPage[] = crawlResult.pages.map((p) => ({
        url: p.url,
        title: extractPageTitle(p.html),
      }));
      const visibleTextLength = crawlResult.pages.reduce(
        (total, page) => total + extractPageText(page.html, Number.MAX_SAFE_INTEGER).length,
        0,
      );
      if (visibleTextLength < MIN_VISIBLE_TEXT_CHARS) {
        logger.warn(
          { url, visibleTextLength },
          "Competitor appears to require JavaScript rendering — including as not evaluable",
        );
        return {
          name: competitorDomain,
          url: normalizedUrl,
          technicalScore: 0,
          schemaScore: 0,
          contentScore: null,
          headingScore: 0,
          faqScore: 0,
          compositeScore: 0,
          crawledPagesCount: crawlResult.pages.length,
          crawledPages,
          findings: null,
          error: "Nicht auswertbar",
          errorReason: "js_rendered",
        };
      }

      const technicalResult = analyzeTechnicalSeo(crawlResult, normalizedUrl);
      const schemaResult = analyzeSchemaOrg(crawlResult.pages, schemaParams as unknown as SchemaScoreParams);
      const headingResult = analyzeHeadings(crawlResult.pages, [], headingParams as unknown as HeadingScoreParams);
      const [faqResult, contentScore] = await Promise.all([
        analyzeFaq(crawlResult.pages, faqParams as unknown as FaqScoreParams),
        (async (): Promise<number | null> => {
          const contentStartedAt = Date.now();
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          try {
            const contentResult = await Promise.race([
              analyzeContentRelevance(crawlResult.pages, questionnaireContext),
              new Promise<never>((_, reject) => {
                timeoutId = setTimeout(
                  () => reject(new Error("Competitor content analysis timed out")),
                  CONTENT_TIMEOUT_MS,
                );
              }),
            ]);
            if (contentResult.failed === true) {
              logger.warn(
                { competitorDomain, reason: "failed flag", durationMs: Date.now() - contentStartedAt },
                "Competitor content analysis failed",
              );
              return null;
            }
            return contentResult.score;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const reason = message === "Competitor content analysis timed out" ? "timeout" : message;
            logger.warn(
              { competitorDomain, reason, durationMs: Date.now() - contentStartedAt },
              "Competitor content analysis failed",
            );
            return null;
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
          }
        })(),
      ]);

      const competitorScores = {
        technicalScore: technicalResult.score,
        schemaScore: schemaResult.score,
        contentScore,
        headingScore: headingResult.score,
        faqScore: faqResult.score,
        compositeScore: 0,
      };
      competitorScores.compositeScore = calculateComparisonScore(competitorScores);
      const { advantages, disadvantages } = buildComparisonAreas(mainSiteScores, competitorScores);
      logger.info(
        { competitorDomain, advantages, disadvantages },
        "Competitor comparison areas determined",
      );

      let findings: CompetitorFindings | null = null;
      try {
        findings = await generateFindings(
          "Ihre Website",
          mainSiteScores,
          competitorDomain,
          competitorScores,
          advantages,
          disadvantages,
        );
        if (findings) {
          if (advantages === "keine") {
            findings.yourAdvantage =
              "In keinem der verglichenen Bereiche liegt Ihre Website deutlich vorn.";
          }
          if (disadvantages === "keine") {
            findings.betterThanYou =
              "Dieser Wettbewerber liegt in keinem der verglichenen Bereiche deutlich vor Ihrer Website.";
          }
        }
      } catch {
        findings = null;
      }

      return {
        name: competitorDomain,
        url: normalizedUrl,
        ...competitorScores,
        crawledPagesCount: crawlResult.pages.length,
        crawledPages,
        findings,
      };
    } catch (err) {
      logger.warn({ url, err }, "Competitor analysis failed — including with zero scores");
      return {
        name: competitorDomain,
        url: normalizedUrl,
        technicalScore: 0,
        schemaScore: 0,
        contentScore: 0,
        headingScore: 0,
        faqScore: 0,
        compositeScore: 0,
        crawledPagesCount: 0,
        crawledPages: [],
        findings: null,
        error: "Nicht erreichbar",
      };
    }
  }));

  return { competitors, mainComparisonScore };
}
