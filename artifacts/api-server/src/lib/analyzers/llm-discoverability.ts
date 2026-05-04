import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";

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
  text: string;
}

function extractPageText(html: string, maxLen = 3000): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function buildPageBlocks(pages: CrawledPage[], perPage = 1500, totalCap = 8): PageBlock[] {
  return pages.slice(0, totalCap).map((p) => ({
    url: p.url,
    text: extractPageText(p.html, perPage),
  }));
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
  const prompt = `You are simulating a B2B buyer in early research mode who does NOT yet know any specific vendor.
Based on the website content below, infer the product category, industry, and key use cases.

${context ? `Context:\n${context}\n\n` : ""}

Website content sample:
${combinedContent.slice(0, 4000)}

Generate exactly 6 realistic German-language questions a buyer would ask an AI assistant when researching this category.
Hard rules:
- Do NOT mention any specific company name, brand, or domain.
- Frame the questions around the problem, use case, comparison criteria, or selection guidance.
- Mix question types: capability ("Welche Anbieter bieten ...?"), comparison ("Wie unterscheiden sich ...?"), use-case ("Wie kann ich ... lösen?"), selection ("Worauf sollte ich bei ... achten?").

Return ONLY valid JSON:
{"questions": ["<q1>", "<q2>", "<q3>", "<q4>", "<q5>", "<q6>"]}`;

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const block = resp.content[0];
    if (block.type !== "text") return [];
    const parsed = tryParseJson<{ questions?: string[] }>(block.text);
    return (parsed?.questions ?? []).slice(0, 6);
  } catch (err) {
    logger.warn({ err }, "LLM Part A generation failed");
    return [];
  }
}

async function generateBrandQuestions(
  combinedContent: string,
  company: string,
  domain: string,
): Promise<string[]> {
  const prompt = `You are simulating a B2B buyer who already knows the company "${company}" (domain: ${domain})
and wants to verify specific information before contacting them.

Website content sample:
${combinedContent.slice(0, 4000)}

Generate exactly 4 realistic German-language questions that explicitly mention "${company}".
Mix categories like: certifications, product specs, delivery times, support, comparisons, use-case fit.

Examples of the right framing:
- "Welche Zertifizierungen hat ${company} für [specific industry]?"
- "Welche Lieferzeiten bietet ${company} für [product]?"

Return ONLY valid JSON:
{"questions": ["<q1>", "<q2>", "<q3>", "<q4>"]}`;

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const block = resp.content[0];
    if (block.type !== "text") throw new Error("non-text response");
    const parsed = tryParseJson<{ questions?: string[] }>(block.text);
    const qs = (parsed?.questions ?? []).slice(0, 4);
    if (qs.length === 0) throw new Error("empty");
    return qs;
  } catch (err) {
    logger.warn({ err }, "LLM Part B generation failed; using fallbacks");
    return [
      `Welche Zertifizierungen hat ${company}?`,
      `Welche Produkte bietet ${company} an?`,
      `Wie ist der Support bei ${company}?`,
      `Welche typischen Lieferzeiten bietet ${company}?`,
    ];
  }
}

async function rateQuestionsWithSources(
  questions: string[],
  pageBlocks: PageBlock[],
): Promise<LlmQuestion[]> {
  if (questions.length === 0) return [];

  const pagesDoc = pageBlocks
    .map((p, i) => `[PAGE ${i + 1}] URL: ${p.url}\n${p.text}`)
    .join("\n\n")
    .slice(0, 12000);

  const urlList = pageBlocks.map((p) => p.url);

  const prompt = `KRITISCHE ANFORDERUNG: Alle Ausgaben ausnahmslos auf Deutsch. Kein einziges englisches Wort in irgendeinem Feld. Sprache: Deutsch. Nur Deutsch.

Using ONLY the crawled website pages below as your knowledge source,
rate how completely you could answer each question (1=cannot answer at all, 5=fully and specifically answerable).

For each question, also identify the SINGLE best-matching page URL that supports the answer.
If no page covers the question adequately (rating 1 or 2), set "sourceUrl" to null.
The sourceUrl MUST be one of the exact URLs listed in the pages, or null.

Crawled pages:
${pagesDoc}

Available URLs (must pick exactly one of these or null):
${JSON.stringify(urlList)}

Questions to rate:
${JSON.stringify(questions)}

Return ONLY valid JSON:
{"ratings": [
  {"question": "<q>", "rating": <1-5>, "gap": "<kurze deutsche Erklärung was fehlt oder warum die Bewertung so ist>", "sourceUrl": <"url" or null>}
]}

WIEDERHOLUNG: Antworte ausschließlich auf Deutsch. Das gap-Feld muss vollständig auf Deutsch sein. Englische Ausgaben sind nicht akzeptabel.`;

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const block = resp.content[0];
    if (block.type !== "text") throw new Error("non-text response");
    const parsed = tryParseJson<{ ratings?: Array<Partial<LlmQuestion>> }>(block.text);
    const ratings = parsed?.ratings ?? [];
    if (ratings.length === 0) throw new Error("empty ratings");
    const validUrls = new Set(urlList);
    return questions.map((q, i) => {
      const r = ratings[i] ?? {};
      const src = r.sourceUrl && validUrls.has(r.sourceUrl) ? r.sourceUrl : null;
      const rating = typeof r.rating === "number" ? Math.min(5, Math.max(1, Math.round(r.rating))) : 3;
      return {
        question: typeof r.question === "string" && r.question.length > 0 ? r.question : q,
        rating,
        gap: typeof r.gap === "string" ? r.gap : "",
        sourceUrl: src,
      };
    });
  } catch (err) {
    logger.warn({ err }, "LLM rating failed; using neutral fallback");
    return questions.map((q) => ({
      question: q,
      rating: 3,
      gap: "Analyse nicht verfügbar",
      sourceUrl: null,
    }));
  }
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
): Promise<LlmDiscoverabilityResult> {
  const pageBlocks = buildPageBlocks(pages);
  const combinedContent = pageBlocks.map((b) => b.text).join("\n\n---\n\n").slice(0, 10000);

  const company = (options.companyName ?? "").trim() || "das Unternehmen";
  let domain = "";
  try { domain = options.url ? new URL(options.url).hostname : ""; } catch { /* ignore */ }

  const defaultPart: LlmPart = { label: "", weight: 0, avgRating: 0, score: 0, questions: [] };
  const defaultResult: LlmDiscoverabilityResult = {
    score: 50,
    avgRating: 2.5,
    questions: [],
    partA: { ...defaultPart, label: "Teil A — Problem-/Kategorie-Fragen (ohne Markenname)", weight: 0.7 },
    partB: { ...defaultPart, label: "Teil B — Marken-Verifikationsfragen", weight: 0.3 },
  };

  try {
    const [partAQuestions, partBQuestions] = await Promise.all([
      generateProblemQuestions(combinedContent, questionnaireContext),
      generateBrandQuestions(combinedContent, company, domain),
    ]);

    const [partARated, partBRated] = await Promise.all([
      rateQuestionsWithSources(partAQuestions, pageBlocks),
      rateQuestionsWithSources(partBQuestions, pageBlocks),
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
    logger.warn({ err }, "LLM discoverability analysis failed");
    return defaultResult;
  }
}
