import { anthropic } from "@workspace/integrations-anthropic-ai";
import { crawlSite } from "../crawler";
import { analyzeTechnicalSeo } from "./technical-seo";
import { analyzeSchemaOrg } from "./schema-org";
import { analyzeHeadings } from "./headings";
import { analyzeFaq } from "./faq";
import { getPrompt, fillTemplate } from "../prompt-manager.js";
import { logger } from "../logger";

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
  contentScore: number;
  headingScore: number;
  faqScore: number;
  compositeScore: number;
  crawledPagesCount: number;
  crawledPages: CompetitorCrawledPage[];
  findings: CompetitorFindings | null;
  error?: string;
}

export interface CompetitorResult {
  competitors: CompetitorScore[];
}

export interface MainSiteScores {
  technicalScore: number;
  schemaScore: number;
  contentScore: number;
  headingScore: number;
  faqScore: number;
  overallScore: number;
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
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim().replace(/\s+/g, " ") : null;
}

async function generateFindings(
  mainDomain: string,
  mainScores: MainSiteScores,
  competitorDomain: string,
  competitorScores: {
    technicalScore: number;
    schemaScore: number;
    contentScore: number;
    headingScore: number;
    faqScore: number;
    compositeScore: number;
  },
): Promise<CompetitorFindings> {
  const prompt = fillTemplate(getPrompt("competitor-analysis"), {
    MAIN_DOMAIN: mainDomain,
    MAIN_TECH: String(mainScores.technicalScore),
    MAIN_SCHEMA: String(mainScores.schemaScore),
    MAIN_CONTENT: String(mainScores.contentScore),
    MAIN_HEADINGS: String(mainScores.headingScore),
    MAIN_FAQ: String(mainScores.faqScore),
    COMP_DOMAIN: competitorDomain,
    COMP_TECH: String(competitorScores.technicalScore),
    COMP_SCHEMA: String(competitorScores.schemaScore),
    COMP_CONTENT: String(competitorScores.contentScore),
    COMP_HEADINGS: String(competitorScores.headingScore),
    COMP_FAQ: String(competitorScores.faqScore),
    COMP_COMPOSITE: String(competitorScores.compositeScore),
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned) as CompetitorFindings;
  } catch (err) {
    logger.warn({ err }, "Failed to generate competitor findings");
    return {
      betterThanYou: "Analyse nicht verfügbar.",
      yourAdvantage: "Analyse nicht verfügbar.",
      recommendation: "Analyse nicht verfügbar.",
    };
  }
}

export async function analyzeCompetitors(
  competitorUrls: string[],
  mainSiteScores?: MainSiteScores,
): Promise<CompetitorResult> {
  const competitors: CompetitorScore[] = [];

  // B1: Process ALL entered competitor URLs — no silent skipping
  for (const url of competitorUrls) {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    const competitorDomain = extractDomainName(normalizedUrl);

    try {
      // B2: Crawl at least 3 pages (homepage + 2 subpages); use 5 to allow
      //     priority scoring to select the best subpages.
      const crawlResult = await crawlSite(normalizedUrl, 5);

      if (crawlResult.pages.length === 0) {
        logger.warn({ url }, "Competitor crawl returned no pages — including with zero scores");
        competitors.push({
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
        });
        continue;
      }

      const technicalResult = analyzeTechnicalSeo(crawlResult, normalizedUrl);
      const schemaResult = analyzeSchemaOrg(crawlResult.pages);
      const headingResult = analyzeHeadings(crawlResult.pages, []);
      const faqResult = await analyzeFaq(crawlResult.pages);

      const contentScore = Math.round(
        (technicalResult.metaTitles.present > 0 ? 30 : 0) +
          (technicalResult.metaDescriptions.present > 0 ? 20 : 0) +
          (technicalResult.imageAltCoverage > 50 ? 20 : 10) +
          (schemaResult.detectedTypes.length > 2 ? 30 : schemaResult.detectedTypes.length * 10),
      );

      const compositeScore = Math.round(
        technicalResult.score * 0.25 +
          schemaResult.score * 0.25 +
          Math.min(100, contentScore) * 0.2 +
          headingResult.score * 0.15 +
          faqResult.score * 0.15,
      );

      const competitorScores = {
        technicalScore: technicalResult.score,
        schemaScore: schemaResult.score,
        contentScore: Math.min(100, contentScore),
        headingScore: headingResult.score,
        faqScore: faqResult.score,
        compositeScore: Math.min(100, compositeScore),
      };

      // B3: Build crawled-page list with titles extracted from HTML
      const crawledPages: CompetitorCrawledPage[] = crawlResult.pages.map((p) => ({
        url: p.url,
        title: extractPageTitle(p.html),
      }));

      let findings: CompetitorFindings | null = null;
      if (mainSiteScores) {
        findings = await generateFindings("Ihre Website", mainSiteScores, competitorDomain, competitorScores);
      }

      competitors.push({
        name: competitorDomain,
        url: normalizedUrl,
        ...competitorScores,
        crawledPagesCount: crawlResult.pages.length,
        crawledPages,
        findings,
      });
    } catch (err) {
      logger.warn({ url, err }, "Competitor analysis failed — including with zero scores");
      competitors.push({
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
      });
    }
  }

  competitors.sort((a, b) => b.compositeScore - a.compositeScore);
  return { competitors };
}
