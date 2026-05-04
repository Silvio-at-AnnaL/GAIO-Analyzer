import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import { anthropic } from "@workspace/integrations-anthropic-ai";
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
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `IMPORTANT: You must respond entirely in German. Every word of every finding must be in German. Do not use any English words, phrases, or sentences anywhere in your response. This is a strict requirement.

Given this B2B industrial website content, evaluate:
(1) Does it describe specific use cases and application scenarios?
(2) Does it answer likely buyer questions (ROI, specs, integrations, certifications, support)?
(3) Is technical depth sufficient for expert-level users?
(4) Are there content gaps a competitor could exploit?

${questionnaireContext ? `Context about the company:\n${questionnaireContext}\n\n` : ""}

Website content:
${truncatedContent}

Return a JSON object (no markdown formatting) with this structure:
{
  "dimensions": [
    {"name": "Use Cases & Applications", "score": <0-10>, "findings": ["finding1", "finding2", "finding3"]},
    {"name": "Buyer Questions", "score": <0-10>, "findings": ["finding1", "finding2", "finding3"]},
    {"name": "Technical Depth", "score": <0-10>, "findings": ["finding1", "finding2", "finding3"]},
    {"name": "Content Gaps", "score": <0-10>, "findings": ["finding1", "finding2", "finding3"]}
  ]
}`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") return defaultResult;

    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
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
