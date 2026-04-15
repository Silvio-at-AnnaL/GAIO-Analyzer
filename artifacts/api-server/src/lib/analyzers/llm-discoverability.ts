import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";

export interface LlmQuestion {
  question: string;
  rating: number;
  gap: string;
}

export interface LlmDiscoverabilityResult {
  score: number;
  questions: LlmQuestion[];
}

function extractPageText(html: string, maxLen = 3000): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export async function analyzeLlmDiscoverability(
  pages: CrawledPage[],
  questionnaireContext: string,
): Promise<LlmDiscoverabilityResult> {
  const content = pages
    .slice(0, 5)
    .map((p) => extractPageText(p.html))
    .join("\n\n---\n\n")
    .slice(0, 10000);

  const defaultResult: LlmDiscoverabilityResult = {
    score: 50,
    questions: [
      { question: "What does this company do?", rating: 3, gap: "Could not complete analysis" },
    ],
  };

  try {
    const questionsMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Based on this B2B industrial company's website content and the following context, generate 10 questions a potential buyer or researcher would ask an AI assistant about this company, its products, or its use cases.

${questionnaireContext ? `Context:\n${questionnaireContext}\n\n` : ""}

Website content:
${content}

Return a JSON array (no markdown) of strings, each a question:
["question1", "question2", ...]`,
        },
      ],
    });

    const qBlock = questionsMsg.content[0];
    if (qBlock.type !== "text") return defaultResult;

    const qMatch = qBlock.text.match(/\[[\s\S]*\]/);
    if (!qMatch) return defaultResult;

    const questions: string[] = JSON.parse(qMatch[0]);
    if (!Array.isArray(questions) || questions.length === 0) return defaultResult;

    const ratingMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Using ONLY the following website content as your knowledge source, rate how completely and accurately you could answer each question. Rate 1-5 (1=cannot answer at all, 5=can answer completely and accurately).

Website content:
${content}

Questions:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Return a JSON array (no markdown) with this structure:
[{"question": "...", "rating": <1-5>, "gap": "explanation of what's missing or incomplete"}]`,
        },
      ],
    });

    const rBlock = ratingMsg.content[0];
    if (rBlock.type !== "text") return defaultResult;

    const rMatch = rBlock.text.match(/\[[\s\S]*\]/);
    if (!rMatch) return defaultResult;

    const rated: LlmQuestion[] = JSON.parse(rMatch[0]);
    if (!Array.isArray(rated) || rated.length === 0) return defaultResult;

    const avgRating = rated.reduce((sum, q) => sum + q.rating, 0) / rated.length;
    const score = Math.round(avgRating * 20);

    return { score: Math.min(100, Math.max(0, score)), questions: rated };
  } catch (err) {
    logger.warn({ err }, "LLM discoverability analysis failed");
    return defaultResult;
  }
}
