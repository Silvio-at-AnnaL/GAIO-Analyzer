import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import { callLLM } from "../ai-client.js";
import { getPrompt, fillTemplate } from "../prompt-manager.js";
import { logger } from "../logger";
import { extractMainText } from "./content-relevance";
import { extractFaqPairs, type FaqPair } from "./faq";

export interface LlmQuestion {
  question: string;
  rating: number;
  gap: string;
  sourceUrl: string | null;
}

export interface LlmPart {
  label: string;
  weight: number;
  avgRating: number;
  score: number;
  questions: LlmQuestion[];
}

export interface LlmDiscoverabilityResult {
  score: number;
  avgRating: number;
  questions: LlmQuestion[];
  partA: LlmPart;
  partB: LlmPart;
}

interface PageBlock {
  url: string;
  title: string;
  mainText: string;
  faqPairs: FaqPair[];
}

function buildPageBlocks(pages: CrawledPage[]): PageBlock[] {
  return pages.slice(0, 10).map((page) => ({
    url: page.url,
    title: cheerio.load(page.html)("title").first().text().replace(/\s+/g, " ").trim(),
    mainText: extractMainText(page.html, Number.MAX_SAFE_INTEGER),
    faqPairs: extractFaqPairs([page]).distinct,
  }));
}

function generationBlock(page: PageBlock): string {
  let excerpt = page.mainText.slice(0, 600);
  if (page.faqPairs.length > 0) {
    const index = excerpt.indexOf(page.faqPairs[0].question);
    if (index >= 0) excerpt = excerpt.slice(0, index);
  }
  return `URL: ${page.url}\nTitle: ${page.title}\n${excerpt}`;
}

function ratingBlock(page: PageBlock): { text: string; mode: "full" | "intro+faq" | "truncated" } {
  if (page.mainText.length <= 4000) return { text: page.mainText, mode: "full" };
  if (page.faqPairs.length === 0) return { text: page.mainText.slice(0, 4000), mode: "truncated" };

  let faq = "";
  for (const { question, answer } of page.faqPairs) {
    const pair = `F: ${question}\nA: ${answer}`;
    if (!faq && pair.length > 2500) {
      faq = pair.slice(0, 2500);
      break;
    }
    const next = faq ? `${faq}\n\n${pair}` : pair;
    if (next.length > 2500) break;
    faq = next;
  }
  return { text: `${page.mainText.slice(0, 1500)}\n[FAQ]\n${faq}`, mode: "intro+faq" };
}

function tryParseJson<T>(raw: string): T | null {
  const stripped = raw.trim();
  // Try fenced blocks
  if (stripped.includes("```")) {
    for (const chunk of stripped.split("```")) {
      let c = chunk.trim();
      if (c.startsWith("json")) c = c.slice(4).trim();
      if (c.startsWith("{") || c.startsWith("[")) {
        try { return JSON.parse(c) as T; } catch { /* keep trying */ }
      }
    }
  }
  // Direct
  try { return JSON.parse(stripped) as T; } catch { /* keep trying */ }
  // Bracket-matched extraction
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = stripped.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < stripped.length; i++) {
      if (stripped[i] === open) depth++;
      else if (stripped[i] === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(stripped.slice(start, i + 1)) as T; } catch { break; }
        }
      }
    }
  }
  return null;
}

async function generateProblemQuestions(
  combinedContent: string,
  context: string,
): Promise<string[]> {
  const prompt = fillTemplate(await getPrompt("llm-discoverability-a"), {
    QUESTIONNAIRE_CONTEXT: context ? `Context:\n${context}\n\n` : "",
    COMBINED_CONTENT: combinedContent,
  });

  const text = await callLLM(prompt, 8192, 0, { module: "llm-discoverability-a" });
  const parsed = tryParseJson<{ questions?: string[] }>(text);
  return (Array.isArray(parsed?.questions) ? parsed.questions : [])
    .filter((question): question is string => typeof question === "string" && !!question.trim())
    .slice(0, 6);
}

async function generateBrandQuestions(
  combinedContent: string,
  company: string,
  domain: string,
): Promise<string[]> {
  const prompt = fillTemplate(await getPrompt("llm-discoverability-b"), {
    COMPANY_NAME: company,
    DOMAIN: domain,
    COMBINED_CONTENT: combinedContent,
  });

  const text = await callLLM(prompt, 8192, 0, { module: "llm-discoverability-b" });
  const parsed = tryParseJson<{ questions?: string[] }>(text);
  return (Array.isArray(parsed?.questions) ? parsed.questions : [])
    .filter((question): question is string => typeof question === "string" && !!question.trim())
    .slice(0, 4);
}

async function rateQuestionsWithSources(
  questions: string[],
  pagesDoc: string,
  urlList: string[],
  module: "llm-discoverability-rating-a" | "llm-discoverability-rating-b",
): Promise<LlmQuestion[]> {
  const prompt = fillTemplate(await getPrompt("llm-discoverability-rating"), {
    PAGES_DOC: pagesDoc,
    URL_LIST: JSON.stringify(urlList),
    QUESTIONS: JSON.stringify(questions),
  });

  const text = await callLLM(prompt, 8192, 0, { module });
  const parsed = tryParseJson<{ ratings?: Array<Partial<LlmQuestion>> }>(text);
  const ratings = parsed?.ratings;
  if (!Array.isArray(ratings) || ratings.length !== questions.length) {
    throw new Error("rating count mismatch or no ratings");
  }
  if (ratings.some((rating) => typeof rating?.rating !== "number" || !Number.isFinite(rating.rating))) {
    throw new Error("non-finite or non-numeric rating");
  }
  const validUrls = new Set(urlList);
  return questions.map((question, i) => {
    const r = ratings[i];
    return {
      question,
      rating: Math.min(5, Math.max(1, Math.round(r.rating!))),
      gap: typeof r.gap === "string" ? r.gap : "",
      sourceUrl: r.sourceUrl && validUrls.has(r.sourceUrl) ? r.sourceUrl : null,
    };
  });
}

function summarizePart(label: string, weight: number, questions: LlmQuestion[]): LlmPart {
  if (questions.length === 0) {
    return { label, weight, avgRating: 0, score: 0, questions: [] };
  }
  const avg = questions.reduce((s, q) => s + q.rating, 0) / questions.length;
  return {
    label,
    weight,
    avgRating: Math.round(avg * 100) / 100,
    score: Math.round(avg * 20),
    questions,
  };
}

export async function analyzeLlmDiscoverability(
  pages: CrawledPage[],
  questionnaireContext: string,
  options: { companyName?: string | null; url?: string | null } = {},
): Promise<LlmDiscoverabilityResult | null> {
  try {
    const pageBlocks = buildPageBlocks(pages);
    const generationPages = pageBlocks.map((page) => ({ url: page.url, text: generationBlock(page) }));
    const combinedContent = generationPages.map((page) => page.text).join("\n\n---\n\n");
    const ratingPages = pageBlocks.map((page, index) => {
      const { text, mode } = ratingBlock(page);
      return {
        url: page.url,
        text: `[PAGE ${index + 1}] URL: ${page.url}\n${text}`,
        mode,
        faqPairs: page.faqPairs.length,
      };
    });
    const pagesDoc = ratingPages.map((page) => page.text).join("\n\n");
    const urlList = pageBlocks.map((page) => page.url);
    logger.info({
      pageCount: pageBlocks.length,
      generation: {
        totalChars: combinedContent.length,
        pages: generationPages.map(({ url, text }) => ({ url, chars: text.length })),
      },
      rating: {
        totalChars: pagesDoc.length,
        pages: ratingPages.map(({ url, text, mode, faqPairs }) => ({ url, chars: text.length, mode, faqPairs })),
      },
    }, "llm discoverability input built");

    const company = (options.companyName ?? "").trim() || "das Unternehmen";
    let domain = "";
    try { domain = options.url ? new URL(options.url).hostname : ""; } catch { /* ignore */ }

    const [partAQuestions, partBQuestions] = await Promise.all([
      generateProblemQuestions(combinedContent, questionnaireContext),
      generateBrandQuestions(combinedContent, company, domain),
    ]);
    if (partAQuestions.length === 0) throw new Error("Part A generated no questions");
    if (partBQuestions.length === 0) throw new Error("Part B generated no questions");

    const [partARated, partBRated] = await Promise.all([
      rateQuestionsWithSources(partAQuestions, pagesDoc, urlList, "llm-discoverability-rating-a"),
      rateQuestionsWithSources(partBQuestions, pagesDoc, urlList, "llm-discoverability-rating-b"),
    ]);

    const partA = summarizePart("Teil A — Problem-/Kategorie-Fragen (ohne Markenname)", 0.7, partARated);
    const partB = summarizePart("Teil B — Marken-Verifikationsfragen", 0.3, partBRated);

    const weightedScore = partA.score * partA.weight + partB.score * partB.weight;
    const allQuestions = [...partA.questions, ...partB.questions];
    const overallAvg = allQuestions.length > 0
      ? allQuestions.reduce((s, q) => s + q.rating, 0) / allQuestions.length
      : 0;

    return {
      score: Math.round(Math.min(100, Math.max(0, weightedScore))),
      avgRating: Math.round(overallAvg * 100) / 100,
      questions: allQuestions,
      partA,
      partB,
    };
  } catch (err) {
    logger.warn({ reason: err instanceof Error ? err.message : String(err) }, "llm discoverability unavailable");
    return null;
  }
}
