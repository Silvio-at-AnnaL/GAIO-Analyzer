import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import { callLLM } from "../ai-client.js";
import { getPrompt, fillTemplate } from "../prompt-manager.js";
import { logger } from "../logger";

export interface ContentDimension {
  name: string;
  score: number;
  findings: string[];
}

export interface ContentRelevanceResult {
  score: number;
  dimensions: ContentDimension[];
}

function extractPageText(html: string, maxLen = 4000): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.slice(0, maxLen);
}

export async function analyzeContentRelevance(
  pages: CrawledPage[],
  questionnaireContext: string,
): Promise<ContentRelevanceResult> {
  const contentSamples = pages
    .slice(0, 5)
    .map((p) => `--- Page: ${p.url} ---\n${extractPageText(p.html)}`)
    .join("\n\n");

  const truncatedContent = contentSamples.slice(0, 12000);

  const defaultResult: ContentRelevanceResult = {
    score: 50,
    dimensions: [
      { name: "Use Cases & Applications", score: 5, findings: ["Analysis could not be completed"] },
      { name: "Buyer Questions", score: 5, findings: ["Analysis could not be completed"] },
      { name: "Technical Depth", score: 5, findings: ["Analysis could not be completed"] },
      { name: "Content Gaps", score: 5, findings: ["Analysis could not be completed"] },
    ],
  };

  try {
    const contextBlock = questionnaireContext
      ? `Context about the company:\n${questionnaireContext}\n\n`
      : "";
    const prompt = fillTemplate(getPrompt("content-relevance"), {
      QUESTIONNAIRE_CONTEXT: contextBlock,
      CRAWLED_CONTENT: truncatedContent,
    });

    const text = await callLLM(prompt, 8192);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return defaultResult;
    const parsed = JSON.parse(jsonMatch[0]);
    const dimensions: ContentDimension[] = parsed.dimensions || [];

    if (dimensions.length === 0) return defaultResult;

    const avgScore = dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;
    const score = Math.round(avgScore * 10);

    return { score: Math.min(100, Math.max(0, score)), dimensions };
  } catch (err) {
    logger.warn({ err }, "Content relevance analysis failed");
    return defaultResult;
  }
}
