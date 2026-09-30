import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import { callLLM } from "../ai-client.js";
import { getPrompt, fillTemplate } from "../prompt-manager.js";
import { logger } from "../logger";
import { extractMainText } from "./content-relevance";
import { extractFaqPairs, type FaqPair } from "./faq";
import { buildPassages, selectForQuestion } from "./passage-retrieval";

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

interface SelectedQuestion {
  id: string;
  question: string;
  passageUrls: Set<string>;
}

async function rateQuestionsWithSources(
  partA: string[],
  partB: string[],
  passages: ReturnType<typeof buildPassages>,
): Promise<{ partA: LlmQuestion[]; partB: LlmQuestion[] }> {
  const selected: SelectedQuestion[] = [];
  const selectedLog: Array<{
    id: string; chars: number; fallback: boolean;
    passages: Array<{ url: string; score: number }>;
  }> = [];
  const blocks = [
    ...partA.map((question, index) => ({ id: `q${index + 1}`, question })),
    ...partB.map((question, index) => ({ id: `b${index + 1}`, question })),
  ].map(({ id, question }) => {
    const selection = selectForQuestion(question, passages);
    selected.push({ id, question, passageUrls: new Set(selection.passages.map(p => p.url)) });
    selectedLog.push({
      id,
      chars: selection.passages.reduce((sum, p) => sum + p.text.length, 0),
      fallback: selection.fallback,
      passages: selection.passages.map(p => ({
        url: p.url, score: Math.round(p.score * 100) / 100,
      })),
    });
    return [`[${id}] ${question}`, ...selection.passages.map((passage, index) =>
      `--- Passage ${index + 1} (URL: ${passage.url})\n${passage.text}`)].join("\n");
  });
  logger.info({ questions: selectedLog }, "llm discoverability passages selected");

  const prompt = fillTemplate(await getPrompt("llm-discoverability-rating-v2"), {
    QUESTION_BLOCKS: blocks.join("\n\n"),
  });
  const text = await callLLM(prompt, 8192, 0, { module: "llm-discoverability-rating" });
  const parsed = tryParseJson<{
    ratings?: Array<{ id?: unknown; rating?: unknown; gap?: unknown; sourceUrl?: unknown }>;
  }>(text);
  const ratings = parsed?.ratings;
  if (!Array.isArray(ratings) || ratings.length !== selected.length) {
    throw new Error("rating count mismatch or no ratings");
  }
  const byId = new Map<string, (typeof ratings)[number]>();
  const expected = new Set(selected.map(item => item.id));
  for (const rating of ratings) {
    if (!rating || typeof rating.id !== "string" || !expected.has(rating.id) || byId.has(rating.id)) {
      throw new Error("missing, duplicate or unknown rating id");
    }
    if (typeof rating.rating !== "number" || !Number.isFinite(rating.rating)) {
      throw new Error("non-finite or non-numeric rating");
    }
    byId.set(rating.id, rating);
  }
  if (byId.size !== expected.size) throw new Error("missing rating id");
  const mapped = selected.map(({ id, question, passageUrls }): LlmQuestion => {
    const rating = byId.get(id)!;
    return {
      question,
      rating: Math.min(5, Math.max(1, Math.round(rating.rating as number))),
      gap: typeof rating.gap === "string" ? rating.gap : "",
      sourceUrl: typeof rating.sourceUrl === "string" && passageUrls.has(rating.sourceUrl)
        ? rating.sourceUrl : null,
    };
  });
  return { partA: mapped.slice(0, partA.length), partB: mapped.slice(partA.length) };
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
    score: Math.round((avg - 1) * 25),
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
    const passages = buildPassages(pages);
    logger.info({
      pageCount: pageBlocks.length,
      generation: {
        totalChars: combinedContent.length,
        pages: generationPages.map(({ url, text }) => ({ url, chars: text.length })),
      },
      rating: {
        passages: passages.length,
        faqPassages: passages.filter(p => p.kind === "faq").length,
        pages: pageBlocks.map(page => {
          const pagePassages = passages.filter(p => p.url === page.url);
          return {
            url: page.url, passages: pagePassages.length,
            chars: pagePassages.reduce((sum, p) => sum + p.text.length, 0),
          };
        }),
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

    const { partA: partARated, partB: partBRated } =
      await rateQuestionsWithSources(partAQuestions, partBQuestions, passages);

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
