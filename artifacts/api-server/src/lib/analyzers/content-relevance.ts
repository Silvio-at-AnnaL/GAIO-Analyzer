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
  failed?: boolean;
}

export function extractPageText(html: string, maxLen = 4000): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.slice(0, maxLen);
}

export function extractMainText(html: string, maxLen: number): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const main = $("main, article, [role='main']").first();
  if (main.length) return main.text().replace(/\s+/g, " ").trim().slice(0, maxLen);

  $("nav, header, footer, aside, form, [role='navigation'], [role='banner'], [role='contentinfo']").remove();
  $("div, section, ul, ol").each((_, element) => {
    const node = $(element);
    // Descendants of a removed ancestor must not be processed a second time.
    if (!node.closest("body").length || node.find("h1").length) return;
    const text = node.text().replace(/\s+/g, " ").trim();
    if (text.length < 200) return;
    const linkText = node.find("a").text().replace(/\s+/g, " ").trim();
    if (linkText.length / text.length > 0.5) node.remove();
  });
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, maxLen);
}

const DIMENSIONS = [
  { key: "use_cases", name: "Anwendungsfälle & Einsatzszenarien" },
  { key: "buyer_questions", name: "Käuferfragen & Entscheidungshilfen" },
  { key: "technical_depth", name: "Technische Tiefe" },
  { key: "completeness", name: "Inhaltliche Vollständigkeit" },
] as const;

function validatedDimensions(value: unknown): ContentDimension[] | null {
  if (!Array.isArray(value)) return null;
  const raw = value as Array<Record<string, unknown> | null>;
  const keyedIndexes = DIMENSIONS.map(({ key }) =>
    raw.findIndex((dimension) => dimension?.key === key));
  const used = new Set(keyedIndexes.filter((index) => index >= 0));

  const dimensions = DIMENSIONS.map((expected, position) => {
    let index = keyedIndexes[position];
    if (index < 0) {
      // An unkeyed legacy response still maps by position, even if other
      // dimensions in the response have keys and appear out of order.
      index = !used.has(position) && !raw[position]?.key
        ? position
        : raw.findIndex((dimension, candidate) => !used.has(candidate) && !dimension?.key);
      if (index < 0) return null;
      used.add(index);
    }
    const dimension = raw[index];
    if (!dimension || typeof dimension.score !== "number" || !Number.isFinite(dimension.score)
      || !Array.isArray(dimension.findings)
      || !dimension.findings.every((finding: unknown) => typeof finding === "string")) return null;
    return {
      name: typeof dimension.name === "string" && dimension.name.trim()
        ? dimension.name : expected.name,
      score: Math.max(0, Math.min(10, Math.round(dimension.score))),
      findings: dimension.findings as string[],
    };
  });
  return dimensions.every((dimension) => dimension !== null)
    ? dimensions as ContentDimension[]
    : null;
}

export async function analyzeContentRelevance(
  pages: CrawledPage[],
  questionnaireContext: string,
): Promise<ContentRelevanceResult> {
  const selectedPages = pages.slice(0, 10);
  const pageCount = selectedPages.length;
  const perPageChars = pageCount ? Math.floor(40_000 / pageCount) : 0;
  const pageTexts = selectedPages.map(({ url, html }) => ({
    url,
    text: extractMainText(html, perPageChars),
  }));
  const contentSamples = pageTexts
    .map(({ url, text }) => `--- Page: ${url} ---\n${text}`)
    .join("\n\n");
  logger.info({
    pageCount,
    perPageChars,
    totalChars: pageTexts.reduce((sum, page) => sum + page.text.length, 0),
    pages: pageTexts.map(({ url, text }) => ({ url, chars: text.length })),
  }, "content relevance input built");

  const defaultResult: ContentRelevanceResult = {
    score: 50,
    failed: true,
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
    const prompt = fillTemplate(await getPrompt("content-relevance"), {
      QUESTIONNAIRE_CONTEXT: contextBlock,
      CRAWLED_CONTENT: contentSamples,
    });

    const text = await callLLM(prompt, 8192);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return defaultResult;
    const parsed = JSON.parse(jsonMatch[0]);
    const dimensions = validatedDimensions(parsed.dimensions);
    if (!dimensions) return defaultResult;

    const avgScore = dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;
    const score = Math.round(avgScore * 10);

    return { score: Math.min(100, Math.max(0, score)), dimensions };
  } catch (err) {
    logger.warn({ err }, "Content relevance analysis failed");
    return defaultResult;
  }
}
