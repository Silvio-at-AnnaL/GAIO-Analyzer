import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import { callLLM } from "../ai-client.js";
import { getPrompt, fillTemplate } from "../prompt-manager.js";
import { logger } from "../logger";

const MIN_ANSWER_CHARS = 40;
const SUMMARY_QUESTION_START = /^(?:Was kostet|Wie viel|Wieviel|Was|Wie|Warum|Wann|Wo|Wer|Welche|Welcher|Welches|Kann|Können|Darf|Dürfen|Muss|Müssen|Gibt|Gilt|Ist|Sind|Haben|Hat|Bietet|Bieten|How|What|Why|When|Where|Who|Which|Can|Do|Does|Is|Are)\b/iu;

export interface FaqScoreParams {
  weight_schema: number;
  weight_visible: number;
  weight_scope: number;
  weight_quality: number;
  schema_full_from: number;
  visible_full_from: number;
  scope_full_from: number;
  scope_mid_from: number;
  scope_mid_factor: number;
  scope_low_factor: number;
}

export const DEFAULT_FAQ_PARAMS: FaqScoreParams = {
  weight_schema: 40,
  weight_visible: 20,
  weight_scope: 15,
  weight_quality: 25,
  schema_full_from: 4,
  visible_full_from: 3,
  scope_full_from: 6,
  scope_mid_from: 3,
  scope_mid_factor: 0.55,
  scope_low_factor: 0.2,
};

export interface FaqPair {
  question: string;
  answer: string;
}

export interface FaqResult {
  score: number;
  faqItemsFound: number;
  hasFaqSchema: boolean;
  hasHtmlFaq: boolean;
  qualityAssessment: string | null;
  schemaQuestionCount: number;
  visiblePairCount: number;
  qualityScore: number | null;
  breakdown: Record<"schema" | "visible" | "scope" | "quality", { points: number; max: number }>;
  params: FaqScoreParams;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const questionKey = (question: string) => clean(question).toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+$/gu, "");
const stripTags = (value: string) => clean(cheerio.load(value).root().text());

function addPair(target: Map<string, FaqPair>, question: string, answer: string): void {
  const pair = { question: clean(question), answer: clean(answer) };
  const key = questionKey(pair.question);
  if (key && pair.answer && !target.has(key)) target.set(key, pair);
}

function schemaPairs(html: string, target: Map<string, FaqPair>): void {
  const $ = cheerio.load(html);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    if (types.includes("FAQPage") && Array.isArray(node.mainEntity)) {
      for (const entry of node.mainEntity) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry as Record<string, unknown>;
        const answer = Array.isArray(item.acceptedAnswer)
          ? item.acceptedAnswer[0]
          : item.acceptedAnswer;
        const answerText = answer && typeof answer === "object"
          ? (answer as Record<string, unknown>).text
          : null;
        const question = typeof item.name === "string" ? item.name : item.text;
        if (typeof question === "string" && typeof answerText === "string") {
          addPair(target, stripTags(question), stripTags(answerText));
        }
      }
    }
    if (node["@graph"]) visit(node["@graph"]);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (raw) visit(JSON.parse(raw));
    } catch {
      // Malformed JSON-LD is not a FAQ.
    }
  });
}

function visiblePairs(html: string, target: Map<string, FaqPair>): void {
  const $ = cheerio.load(html);
  $("details").each((_, el) => {
    const summary = $(el).children("summary").first();
    if (!summary.length) return;
    const question = clean(summary.text());
    if (!question.endsWith("?") && !SUMMARY_QUESTION_START.test(question)) return;
    const answer = clean($(el).clone().children("summary").remove().end().text());
    if (answer.length >= MIN_ANSWER_CHARS) addPair(target, question, answer);
  });
  $("h2, h3, h4").each((_, el) => {
    const question = clean($(el).text());
    if (!question.endsWith("?")) return;
    const answer: string[] = [];
    let sibling = $(el).next();
    while (sibling.length && !sibling.is("h1, h2, h3, h4, h5, h6")) {
      answer.push(sibling.text());
      sibling = sibling.next();
    }
    const text = clean(answer.join(" "));
    if (text.length >= MIN_ANSWER_CHARS) addPair(target, question, text);
  });
}

export function extractFaqPairs(pages: CrawledPage[]): { schema: FaqPair[]; visible: FaqPair[]; distinct: FaqPair[] } {
  const schema = new Map<string, FaqPair>();
  const visible = new Map<string, FaqPair>();
  for (const page of pages) {
    schemaPairs(page.html, schema);
    visiblePairs(page.html, visible);
  }
  const distinct = new Map(schema);
  for (const [key, pair] of visible) {
    if (!distinct.has(key)) distinct.set(key, pair);
  }
  return { schema: [...schema.values()], visible: [...visible.values()], distinct: [...distinct.values()] };
}

export function faqQualityContent(pairs: FaqPair[]): string {
  let content = "";
  for (const { question, answer } of pairs.slice(0, 12)) {
    const shortenedAnswer = answer.length > 800
      ? `${answer.slice(0, 800)} […vom Analyse-Tool gekürzt]`
      : answer;
    const next = `F: ${question.slice(0, 300)}\nA: ${shortenedAnswer}`;
    if (content.length + next.length + (content ? 2 : 0) > 6000) break;
    content += (content ? "\n\n" : "") + next;
  }
  return content;
}

export function parseFaqQualityResponse(response: string): { score: number; assessment: string } | null {
  const lines = response.split(/\r?\n/);
  const scoreLine = lines.findIndex((line) => line.trim().startsWith("BEWERTUNG:"));
  if (scoreLine < 0) return null;
  const match = /^BEWERTUNG:\s*(\d{1,3})\s*$/.exec(lines[scoreLine].trim());
  if (!match) return null;
  const score = Number(match[1]);
  if (score > 100) return null;
  const reasonLine = lines.findIndex((line, index) => index > scoreLine && line.trim().startsWith("BEGRÜNDUNG:"));
  if (reasonLine < 0) return null;
  const assessment = [lines[reasonLine].trim().slice("BEGRÜNDUNG:".length), ...lines.slice(reasonLine + 1)]
    .join("\n").trim();
  return assessment ? { score, assessment } : null;
}

export async function analyzeFaq(
  pages: CrawledPage[],
  params: FaqScoreParams = DEFAULT_FAQ_PARAMS,
): Promise<FaqResult> {
  const pairs = extractFaqPairs(pages);
  const schemaQuestionCount = pairs.schema.length;
  const visiblePairCount = pairs.visible.length;
  const faqItemsFound = pairs.distinct.length;
  let qualityScore: number | null = null;
  let qualityAssessment: string | null = null;

  if (faqItemsFound > 0) {
    let response = "";
    try {
      response = await callLLM(
        fillTemplate(await getPrompt("faq-quality"), { FAQ_CONTENT: faqQualityContent(pairs.distinct) }),
        8192,
      );
      const parsed = parseFaqQualityResponse(response);
      if (parsed) {
        qualityScore = parsed.score;
        qualityAssessment = parsed.assessment;
      } else {
        logger.warn({ response: response.slice(0, 200) }, "FAQ quality assessment unusable");
      }
    } catch (err) {
      logger.warn({ err }, "FAQ quality assessment failed");
      logger.warn({ response: response.slice(0, 200) }, "FAQ quality assessment unusable");
    }
  }

  const oneDecimal = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;
  const schemaPoints = Math.min(schemaQuestionCount, params.schema_full_from) / params.schema_full_from * params.weight_schema;
  const visiblePoints = Math.min(visiblePairCount, params.visible_full_from) / params.visible_full_from * params.weight_visible;
  const scopePoints = faqItemsFound >= params.scope_full_from ? params.weight_scope
    : faqItemsFound >= params.scope_mid_from ? params.weight_scope * params.scope_mid_factor
      : faqItemsFound >= 1 ? params.weight_scope * params.scope_low_factor : 0;
  const qualityPoints = qualityScore === null ? 0 : params.weight_quality * qualityScore / 100;
  const breakdown = {
    schema: {
      points: oneDecimal(schemaPoints),
      max: oneDecimal(params.weight_schema),
    },
    visible: {
      points: oneDecimal(visiblePoints),
      max: oneDecimal(params.weight_visible),
    },
    scope: {
      points: oneDecimal(scopePoints),
      max: oneDecimal(params.weight_scope),
    },
    quality: {
      points: oneDecimal(qualityPoints),
      max: oneDecimal(params.weight_quality),
    },
  };
  const score = Math.max(0, Math.min(100, Math.round(schemaPoints + visiblePoints + scopePoints + qualityPoints)));
  return {
    score,
    faqItemsFound,
    hasFaqSchema: schemaQuestionCount > 0,
    hasHtmlFaq: visiblePairCount > 0,
    qualityAssessment,
    schemaQuestionCount,
    visiblePairCount,
    qualityScore,
    breakdown,
    params: { ...params },
  };
}