import { crawlSite } from "../crawler";
import { analyzeTechnicalSeo } from "./technical-seo";
import { analyzeSchemaOrg } from "./schema-org";
import { logger } from "../logger";

export interface CompetitorScore {
  name: string;
  url: string;
  technicalScore: number;
  schemaScore: number;
  contentScore: number;
  compositeScore: number;
}

export interface CompetitorResult {
  competitors: CompetitorScore[];
}

function extractDomainName(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function analyzeCompetitors(competitorUrls: string[]): Promise<CompetitorResult> {
  const competitors: CompetitorScore[] = [];

  for (const url of competitorUrls.slice(0, 5)) {
    try {
      const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
      const crawlResult = await crawlSite(normalizedUrl, 3);

      if (crawlResult.pages.length === 0) {
        logger.warn({ url }, "Competitor crawl returned no pages");
        continue;
      }

      const technicalResult = analyzeTechnicalSeo(crawlResult, normalizedUrl);
      const schemaResult = analyzeSchemaOrg(crawlResult.pages);

      const contentScore = Math.round(
        (technicalResult.metaTitles.present > 0 ? 30 : 0) +
          (technicalResult.metaDescriptions.present > 0 ? 20 : 0) +
          (technicalResult.imageAltCoverage > 50 ? 20 : 10) +
          (schemaResult.detectedTypes.length > 2 ? 30 : schemaResult.detectedTypes.length * 10),
      );

      const compositeScore = Math.round(
        technicalResult.score * 0.35 + schemaResult.score * 0.35 + contentScore * 0.3,
      );

      competitors.push({
        name: extractDomainName(normalizedUrl),
        url: normalizedUrl,
        technicalScore: technicalResult.score,
        schemaScore: schemaResult.score,
        contentScore: Math.min(100, contentScore),
        compositeScore: Math.min(100, compositeScore),
      });
    } catch (err) {
      logger.warn({ url, err }, "Competitor analysis failed");
    }
  }

  competitors.sort((a, b) => b.compositeScore - a.compositeScore);

  return { competitors };
}
