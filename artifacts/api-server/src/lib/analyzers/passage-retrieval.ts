import type { CrawledPage } from "../crawler";
import { extractMainText } from "./content-relevance";
import { extractFaqPairs } from "./faq";

export interface Passage {
  url: string;
  text: string;
  kind: "faq" | "text";
}

export interface FallbackIntro {
  url: string;
  text: string;
  pageIndex: number;
}

/** Array metadata preserves page intros even when identical passages dedupe. */
export type PassageCollection = Passage[] & { fallbackIntros: FallbackIntro[] };

export interface ScoredPassage extends Passage {
  score: number;
}

export interface PassageSelection {
  passages: ScoredPassage[];
  fallback: boolean;
}

const MAX_PAGES = 10;
const FAQ_PASSAGE_LIMIT = 1200;
const TEXT_PASSAGE_LIMIT = 800;
const SELECTED_CHAR_LIMIT = 4000;
const SELECTED_PASSAGE_LIMIT = 8;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeVerbatimWhitespaceNormalized(text: string, phrase: string): string {
  const normalizedPhrase = phrase.replace(/\s+/g, " ").trim();
  if (!normalizedPhrase) return text;
  const pattern = normalizedPhrase.split(" ").map(escapeRegExp).join("\\s+");
  return text.replace(new RegExp(pattern, "g"), " ").replace(/\s+/g, " ").trim();
}

function splitLongSentence(sentence: string): string[] {
  const pieces: string[] = [];
  for (let offset = 0; offset < sentence.length; offset += TEXT_PASSAGE_LIMIT) {
    const piece = sentence.slice(offset, offset + TEXT_PASSAGE_LIMIT).trim();
    if (piece) pieces.push(piece);
  }
  return pieces;
}

function splitText(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > TEXT_PASSAGE_LIMIT) {
      if (current) chunks.push(current);
      current = "";
      chunks.push(...splitLongSentence(sentence));
      continue;
    }

    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > TEXT_PASSAGE_LIMIT) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Extracts FAQ and text passages from at most ten pages. Identical passage text
 * is retained only once, with the URL of its first occurrence.
 */
export function buildPassages(pages: CrawledPage[]): PassageCollection {
  const passages: Passage[] = [];
  const fallbackIntros: FallbackIntro[] = [];
  const seenText = new Set<string>();

  const addPassage = (passage: Passage): void => {
    if (!passage.text || seenText.has(passage.text)) return;
    seenText.add(passage.text);
    passages.push(passage);
  };

  for (const [pageIndex, page] of pages.slice(0, MAX_PAGES).entries()) {
    let mainText = extractMainText(page.html, Number.MAX_SAFE_INTEGER);
    fallbackIntros.push({ url: page.url, text: mainText.slice(0, 400), pageIndex });
    const faqPairs = extractFaqPairs([page]).distinct;

    for (const { question, answer } of faqPairs) {
      const text = `F: ${question}\nA: ${answer}`.slice(0, FAQ_PASSAGE_LIMIT);
      addPassage({ url: page.url, text, kind: "faq" });
      mainText = removeVerbatimWhitespaceNormalized(mainText, question);
      mainText = removeVerbatimWhitespaceNormalized(mainText, answer);
    }

    for (const text of splitText(mainText)) {
      addPassage({ url: page.url, text, kind: "text" });
    }
  }

  return Object.assign(passages, { fallbackIntros });
}

const STOPWORDS = new Set([
  "aber", "alle", "allem", "allen", "aller", "alles", "als", "also", "am", "an", "ander", "andere",
  "anderem", "anderen", "anderer", "anderes", "anderm", "andern", "anders", "auch", "auf", "aus",
  "bei", "beide", "beiden", "beim", "beispiel", "bin", "bis", "bist", "bitte", "da", "dabei", "dadurch",
  "dafür", "dagegen", "daher", "damit", "danach", "dann", "darauf", "daraus", "darf", "darfst", "dass",
  "daß", "davon", "davor", "dazu", "dein", "deine", "deinem", "deinen", "deiner", "deines", "dem",
  "demselben", "den", "denn", "denselben", "der", "deren", "derer", "des", "deshalb", "desselben",
  "dessen", "desto", "deswegen", "die", "dies", "diese", "dieselbe", "dieselben", "diesem", "diesen",
  "dieser", "dieses", "dir", "doch", "dort", "du", "durch", "ein", "eine", "einem", "einen", "einer",
  "eines", "einige", "einigem", "einigen", "einiger", "einiges", "einmal", "er", "erst", "es", "etwas",
  "euch", "euer", "eure", "eurem", "euren", "eurer", "eures", "für", "gegen", "gewesen", "gibt", "hat",
  "hatte", "hatten", "hier", "hin", "hinter", "ich", "ihm", "ihn", "ihnen", "ihr", "ihre", "ihrem",
  "ihren", "ihrer", "ihres", "im", "in", "indem", "infolge", "ins", "ist", "jede", "jedem", "jeden",
  "jeder", "jedes", "jedoch", "jene", "jenem", "jenen", "jener", "jenes", "jetzt", "kann", "kannst",
  "kein", "keine", "keinem", "keinen", "keiner", "keines", "können", "könnt", "könnte", "könnten",
  "machen", "man", "manche", "manchem", "manchen", "mancher", "manches", "mehr", "mein", "meine",
  "meinem", "meinen", "meiner", "meines", "mich", "mir", "mit", "muss", "musst", "müssen", "müsst",
  "müsste", "nach", "nachdem", "nein", "nicht", "nichts", "noch", "nun", "nur", "ob", "oder", "ohne",
  "per", "pro", "schon", "sehr", "sein", "seine", "seinem", "seinen", "seiner", "seines", "selbst",
  "sich", "sie", "siehe", "sind", "so", "solche", "solchem", "solchen", "solcher", "solches", "soll",
  "sollen", "sollst", "sollte", "sollten", "sondern", "sonst", "sowie", "unter", "uns", "unser",
  "unsere", "unserem", "unseren", "unserer", "unseres", "und", "unsere", "vom", "von", "vor", "wann",
  "war", "waren", "warst", "warum", "was", "weder", "weil", "welche", "welchem", "welchen", "welcher",
  "welches", "wem", "wen", "wenig", "wenige", "weniger", "weniges", "wenn", "wer", "werde", "werden",
  "werdet", "weshalb", "wessen", "wie", "wieder", "wieso", "will", "willst", "wir", "wird", "wirklich",
  "wissen", "wo", "woher", "wohin", "wohl", "wollen", "wollte", "würde", "würden", "zu", "zum", "zur",
  "über", "überhaupt", "zwar", "zwischen", "about", "above", "after", "again", "against", "all", "am",
  "an", "and", "any", "are", "as", "at", "be", "because", "been", "before", "being", "below", "between",
  "both", "but", "by", "can", "could", "did", "do", "does", "doing", "down", "during", "each", "few",
  "for", "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself",
  "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me",
  "more", "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
  "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so", "some", "such",
  "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they",
  "this", "those", "through", "to", "too", "under", "until", "up", "use", "very", "was", "we", "were", "what",
  "when", "where", "which", "while", "who", "whom", "why", "with", "would", "you", "your", "yours",
  "yourself", "yourselves", "worauf", "woraus", "wobei", "wodurch", "womit", "woran", "wovon", "wovor",
  "wozu", "welche", "sollte", "sollten", "kann", "könnte", "können",
]);

function foldGerman(text: string): string {
  return text.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
}
const FOLDED_STOPWORDS = new Set([...STOPWORDS].map(foldGerman));

function stemToken(token: string): string {
  if (token.length <= 5) return token;
  for (const suffix of ["ern", "en", "er", "es", "e", "n", "s"]) {
    if (token.endsWith(suffix)) return token.slice(0, -suffix.length);
  }
  return token;
}

export function normalizeTokens(text: string): string[] {
  return foldGerman(text.toLowerCase())
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3 && !FOLDED_STOPWORDS.has(token))
    .map(stemToken);
}

function tokenMatches(queryToken: string, passageToken: string): boolean {
  return queryToken === passageToken
    || (queryToken.length >= 6 && passageToken.length >= 6
      && (queryToken.includes(passageToken) || passageToken.includes(queryToken)));
}

export function scorePassages(
  question: string,
  passages: Passage[],
  options: { excludeTerms?: string[] } = {},
): ScoredPassage[] {
  const excluded = new Set((options.excludeTerms ?? []).flatMap(normalizeTokens));
  const queryTokens = normalizeTokens(question).filter((token) => !excluded.has(token));
  const tokenized = passages.map((passage) => normalizeTokens(passage.text));
  const count = passages.length;
  const averageLength = count
    ? tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / count
    : 0;
  const k1 = 1.2;
  const b = 0.75;

  return passages.map((passage, index) => {
    const tokens = tokenized[index];
    let score = 0;

    for (const queryToken of queryTokens) {
      const matchingTokens = tokens.filter((token) => tokenMatches(queryToken, token));
      const termFrequency = matchingTokens.length;
      if (!termFrequency) continue;

      const documentFrequency = tokenized.reduce((frequency, document) =>
        frequency + (document.some((token) => tokenMatches(queryToken, token)) ? 1 : 0), 0);
      const inverseDocumentFrequency = Math.log(
        1 + (count - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );
      const lengthNormalization = averageLength
        ? 1 - b + b * tokens.length / averageLength
        : 1;
      score += inverseDocumentFrequency
        * (termFrequency * (k1 + 1))
        / (termFrequency + k1 * lengthNormalization);
    }

    return { ...passage, score };
  });
}

/**
 * Returns the highest-scoring passages within the prompt budget. When no
 * passage matches, returns up to the first 400 characters of each page's
 * earliest text passage in page order, marked as fallback.
 */
export function selectForQuestion(
  question: string,
  passages: Passage[],
  options: { excludeTerms?: string[] } = {},
): PassageSelection {
  const scored = scorePassages(question, passages, options);
  const ranked = scored.filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  if (ranked.length) {
    const selected: ScoredPassage[] = [];
    let chars = 0;
    for (const passage of ranked) {
      if (selected.length >= SELECTED_PASSAGE_LIMIT) break;
      if (chars + passage.text.length > SELECTED_CHAR_LIMIT) continue;
      selected.push(passage);
      chars += passage.text.length;
    }
    return { passages: selected, fallback: false };
  }

  const intros: ScoredPassage[] = [];
  let chars = 0;
  const metadata = (passages as PassageCollection).fallbackIntros;
  const fallbackIntros: FallbackIntro[] = Array.isArray(metadata)
    ? metadata
    : passages.filter(({ kind }) => kind === "text")
      .filter((passage, index, all) => all.findIndex(({ url }) => url === passage.url) === index)
      .map((passage, pageIndex) => ({ url: passage.url, text: passage.text.slice(0, 400), pageIndex }));
  for (const intro of fallbackIntros) {
    const text = intro.text.slice(0, 400);
    if (!text || chars + text.length > SELECTED_CHAR_LIMIT) continue;
    intros.push({ url: intro.url, text, kind: "text", score: 0 });
    chars += text.length;
  }
  return { passages: intros, fallback: true };
}