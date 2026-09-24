import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { logger } from "./logger";
import {
  classifyFetchError,
  classifyHttpStatus,
  detectBlockedContent,
  type CrawlFailReason,
} from "./fetch-diagnostics";

export interface CrawledPage {
  url: string;
  html: string;
  statusCode: number;
  responseTime: number;
  ttfb: number;
}

export interface HreflangVariant {
  lang: string;
  url: string;
}

export interface CrawlFailure {
  url: string;
  reason: CrawlFailReason;
  statusCode?: number;
}

export interface CrawlReliability {
  attempted: number;
  succeeded: number;
  failed: number;
  failures: CrawlFailure[];
}

export interface SitemapResolution {
  topLevelEntries: number;
  filesRead: number;
  filesFailed: number;
  filesSkipped: number;
  nested: boolean;
  nestedExample: string[] | null;
  complete: boolean;
  pageUrlCount: number;
  hasImage: boolean;
  hasVideo: boolean;
}

export interface CrawlResult {
  pages: CrawledPage[];
  skipped: { otherLanguage: number; excludedPath: number; duplicate: number; urls: string[] };
  homepageFailReason?: CrawlFailReason | null;
  timedOut: boolean;
  robotsTxt: string | null;
  sitemapXml: string | null;
  sitemapResolution?: SitemapResolution | null;
  llmsTxt: string | null;
  htmlSitemapHtml: string | null;
  htmlSitemapUrl: string | null;
  sitemapType: "xml" | "xml_index" | "html" | "none";
  robotsTxtExists: boolean;
  sitemapXmlExists: boolean;
  llmsTxtExists: boolean;
  robotsTxtStatus?: TechnicalFileStatus;
  sitemapStatus?: TechnicalFileStatus;
  llmsTxtStatus?: TechnicalFileStatus;
  hreflangVariants: HreflangVariant[];
  reliability: CrawlReliability;
}

export type SiteTechFiles = Pick<CrawlResult,
  "robotsTxt" | "robotsTxtExists" | "robotsTxtStatus" | "llmsTxt" | "llmsTxtExists" |
  "llmsTxtStatus" | "sitemapXml" | "sitemapXmlExists" | "htmlSitemapHtml" |
  "htmlSitemapUrl" | "sitemapType" | "sitemapStatus" | "sitemapResolution">;

export type TechnicalFileStatus = "found" | "missing" | "error";

type FetchTimingResult = Awaited<ReturnType<typeof fetchWithTiming>>;

export interface TechFileFetchResult {
  status: TechnicalFileStatus;
  resp?: FetchTimingResult;
  statusCode?: number;
  reason?: CrawlFailReason;
  durationMs: number;
}

// ─── Priority scoring (unchanged from before) ─────────────────────────────────

const PRIORITY_PATTERNS: Array<{ score: number; pattern: RegExp }> = [
  {
    score: 100,
    pattern:
      /produkt|product|products|produkte|loesungen|solutions|leistungen|services|anwendungen|applications|use-case|usecases|anwendungsfall/i,
  },
  {
    score: 80,
    pattern:
      /referenzen|references|kundenstimmen|testimonials|case-study|fallstudie|anwendungsbeispiel|beispiele|examples/i,
  },
  { score: 60, pattern: /news|blog|presse|press|aktuell|artikel|article|insights/i },
  { score: 40, pattern: /technologie|technology|innovation|industrie|industry/i },
];

const EXCLUDED_KEYWORD_PATTERN =
  /login|logout|cart|warenkorb|checkout|impressum|datenschutz|privacy|cookie|agb|terms|sitemap|feed|rss|wp-admin|wp-json|partials?|ajax|sendfriend|registrieren|register|signup|anmelden|passwort-vergessen|password-reset|lostpassword|kuendigung|kündigung|mein-konto|my-account|customer\/account|merkliste|wishlist|newsletter|suche|search|reviews?_write|review-write|bewertung-schreiben|gaestebuch|guestbook|print\.php|druckansicht|printview|[?&]print=/i;

const EXCLUDED_EXTENSION_PATTERN = /\.(pdf|jpg|jpeg|png|gif|svg|mp4|zip|css|js)(\?|$)/i;
const EXTRA_FETCH_ALLOWANCE = 12;

const EXCLUDED_TRACKING_PARAMS = /[?&](utm_|fbclid|gclid)/i;

// 2-3 letter language codes with optional region, e.g. "de", "en", "zh-CN", "pt-BR"
const LANG_PREFIX_RE = /^\/([a-z]{2,3}(?:-[a-z]{2,4})?)(?:\/|$)/i;

function scoreUrl(urlStr: string): number {
  if (EXCLUDED_KEYWORD_PATTERN.test(urlStr)) return 0;
  if (EXCLUDED_EXTENSION_PATTERN.test(urlStr)) return 0;
  if (EXCLUDED_TRACKING_PARAMS.test(urlStr)) return 0;
  for (const { score, pattern } of PRIORITY_PATTERNS) {
    if (pattern.test(urlStr)) return score;
  }
  return 20;
}

const DE_STOPWORDS = new Set(
  "der die das und ist sind mit für von den dem des eine einen auch oder werden nicht auf im zum zur sich bei wir unsere unser".split(" "),
);
const EN_STOPWORDS = new Set(
  "the and of with for you are this that from our your they have been will more about which".split(" "),
);
const BOILERPLATE_PATTERN = /cookie|consent|borlabs|recaptcha|privacy|banner/i;

export function contentFingerprint(html: string): string | null {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text = ($("body").length ? $("body").text() : $.root().text())
    .replace(/\s+/g, " ").toLowerCase().trim();
  return text.length < 200 ? null : createHash("sha1").update(text).digest("hex");
}

/** Classify the visible main text; short pages use their declared language. */
export function detectPageLanguage(html: string): "de" | "en" | null {
  try {
    const $ = cheerio.load(html);
    const declared = $("html").first().attr("lang")?.trim().toLowerCase().split("-")[0];
    $("script, style, noscript, iframe, nav, header, footer").remove();
    $("[class], [id]").each((_, el) => {
      if (BOILERPLATE_PATTERN.test(`${$(el).attr("class") ?? ""} ${$(el).attr("id") ?? ""}`)) {
        $(el).remove();
      }
    });
    const content = $("main").first().length
      ? $("main").first()
      : $("article").first().length
        ? $("article").first()
        : $("body").first();
    const text = content.text().replace(/\s+/g, " ").trim();
    if (text.length < 200) return declared === "de" || declared === "en" ? declared : null;

    let deTotal = 0;
    let enTotal = 0;
    const deWords = new Set<string>();
    const enWords = new Set<string>();
    for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
      if (DE_STOPWORDS.has(word)) {
        deTotal++;
        deWords.add(word);
      }
      if (EN_STOPWORDS.has(word)) {
        enTotal++;
        enWords.add(word);
      }
    }
    if (deTotal >= enTotal * 1.5 && deTotal >= 5 && deWords.size >= 4) return "de";
    if (enTotal >= deTotal * 1.5 && enTotal >= 5 && enWords.size >= 4) return "en";
    return null;
  } catch {
    return null;
  }
}

// Existing analysis-engine import uses this name for the main site's language.
export const pageLanguage = detectPageLanguage;

// ─── Rule 3: language preference ─────────────────────────────────────────────
// de=2, en=1, neutral (no prefix)=1, anything else=0

function getLangPriority(pathname: string): number {
  const m = pathname.match(LANG_PREFIX_RE);
  if (!m) return 1; // no language prefix → neutral
  const lang = m[1].toLowerCase().split("-")[0];
  if (lang === "de") return 2;
  if (lang === "en") return 1;
  return 0;
}

// ─── Rule 4: path ceiling ─────────────────────────────────────────────────────

function isWithinStartPath(pathname: string, startPath: string): boolean {
  if (startPath === "/" || startPath === "") return true;
  return pathname === startPath || pathname.startsWith(startPath + "/");
}

// ─── Rule 1+2+5: category extraction + depth ──────────────────────────────────

/**
 * Returns the "first meaningful path segment" after the domain/language prefix.
 * Language prefixes (2-3 letter codes, e.g. /de/, /en/, /zh-CN/) are skipped.
 */
function extractCategory(pathname: string, startPath: string): string {
  // Strip the start path prefix first
  let rel = pathname;
  if (startPath.length > 1 && rel.startsWith(startPath)) {
    rel = rel.slice(startPath.length);
  }
  rel = rel.replace(/^\/+/, "");

  const segments = rel.split("/").filter(Boolean);

  // Skip a leading language prefix segment
  let startIdx = 0;
  if (segments[0] && /^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(segments[0])) {
    startIdx = 1;
  }

  return segments[startIdx] || "__root__";
}

/**
 * Depth = number of path segments below the start path.
 */
function extractDepth(pathname: string, startPath: string): number {
  let rel = pathname;
  if (startPath.length > 1 && rel.startsWith(startPath)) {
    rel = rel.slice(startPath.length);
  }
  return rel.split("/").filter(Boolean).length;
}

// ─── Internal queue entry ─────────────────────────────────────────────────────

interface QueueEntry {
  url: string;
  contentScore: number; // 20–100 from PRIORITY_PATTERNS
  category: string;
  depth: number;
  langPriority: number; // 0–2
}

function makeEntry(rawUrl: string, startPath: string): QueueEntry {
  const url = normalizeUrl(rawUrl);
  const parsed = new URL(url);
  const pathname = parsed.pathname;
  return {
    url,
    contentScore: scoreUrl(url),
    category: extractCategory(pathname, startPath),
    depth: extractDepth(pathname, startPath),
    langPriority: getLangPriority(pathname),
  };
}

/**
 * Sort a category queue: shallower first, then higher lang priority, then higher content score.
 */
function sortCategoryQueue(q: QueueEntry[]): void {
  q.sort(
    (a, b) =>
      a.depth - b.depth ||
      b.langPriority - a.langPriority ||
      b.contentScore - a.contentScore,
  );
}


// ─── Fetching ─────────────────────────────────────────────────────────────────

async function fetchWithTiming(
  url: string,
  timeoutMs = 15000,
): Promise<{ html: string; statusCode: number; responseTime: number; ttfb: number; finalUrl: string }> {
  const start = Date.now();
  let ttfb = 0;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("fetch-timeout"));
      }, timeoutMs);
    });

    const work = (async () => {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "GAIOAnalyzer/1.0 (Website Audit Tool)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });
      ttfb = Date.now() - start;
      const html = await response.text();
      return {
        html,
        statusCode: response.status,
        responseTime: Date.now() - start,
        ttfb,
        finalUrl: response.url || url,
      };
    })();

    return await Promise.race([work, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function fetchTechFile(
  url: string,
  timeoutMs: number,
): Promise<TechFileFetchResult> {
  const startedAt = Date.now();
  let attempts = 0;
  let result: TechFileFetchResult | null = null;

  while (attempts < 2) {
    attempts++;
    try {
      const resp = await fetchWithTiming(url, timeoutMs);
      if (resp.statusCode === 200) {
        result = { status: "found", resp, statusCode: resp.statusCode, durationMs: Date.now() - startedAt };
        break;
      }
      if (resp.statusCode >= 400 && resp.statusCode < 500 && resp.statusCode !== 429) {
        result = {
          status: "missing",
          resp,
          statusCode: resp.statusCode,
          reason: classifyHttpStatus(resp.statusCode),
          durationMs: Date.now() - startedAt,
        };
        break;
      }
      result = {
        status: "error",
        resp,
        statusCode: resp.statusCode,
        reason: classifyHttpStatus(resp.statusCode),
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const classified = classifyFetchError(err);
      const reason = err instanceof Error && err.message === "fetch-timeout" ? "timeout" : classified;
      result = { status: "error", reason, durationMs: Date.now() - startedAt };
    }

    if (attempts < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  const finalResult = result ?? {
    status: "error" as const,
    reason: "unknown" as const,
    durationMs: Date.now() - startedAt,
  };
  if (finalResult.status !== "found") {
    let file = url;
    try {
      file = new URL(url).pathname || url;
    } catch {
      // Keep the full URL when it cannot be parsed.
    }
    const fields = {
      file,
      url,
      statusCode: finalResult.statusCode,
      reason: finalResult.reason,
      durationMs: finalResult.durationMs,
      attempts,
    };
    if (finalResult.status === "error") {
      logger.warn(fields, "technical file not retrieved");
    } else {
      logger.info(fields, "technical file not retrieved");
    }
  }
  return finalResult;
}

// ─── HTML parsing helpers ─────────────────────────────────────────────────────

function extractHreflangVariants(html: string, baseUrl: string): HreflangVariant[] {
  const $ = cheerio.load(html);
  const variants: HreflangVariant[] = [];

  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang");
    const href = $(el).attr("href");
    if (!lang || !href) return;
    try {
      const resolved = new URL(href, baseUrl);
      resolved.hash = "";
      variants.push({ lang, url: resolved.href });
    } catch {
      // skip
    }
  });

  return variants;
}

function extractInternalLinks(
  html: string,
  baseUrl: string,
  siteKey: string,
  canon: (url: string) => string,
  startPath: string,
  excludedUrls: Set<string>,
  onExcludedPath: (url: string) => void,
): Array<{ url: string }> {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: Array<{ url: string }> = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (hostKey(resolved.hostname) !== siteKey) return;
      if (!resolved.protocol.startsWith("http")) return;

      const url = canon(resolved.href);

      if (seen.has(url)) return;
      seen.add(url);
      if (excludedUrls.has(url)) return;

      // Rule 4: path ceiling
      const pathname = new URL(url).pathname;
      if (!isWithinStartPath(pathname, startPath)) return;

      // Score must be non-zero (excludes blacklisted/binary URLs)
      if (EXCLUDED_KEYWORD_PATTERN.test(url)) {
        onExcludedPath(url);
        return;
      }
      if (scoreUrl(url) === 0) return;

      results.push({ url });
    } catch {
      // skip
    }
  });

  return results;
}

function parseSitemapUrls(
  xml: string,
  siteKey: string,
  canon: (url: string) => string,
): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>(.*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null) {
    try {
      const url = new URL(match[1].trim());
      if (hostKey(url.hostname) === siteKey) urls.push(canon(url.href));
    } catch {
      // skip
    }
  }
  return urls;
}

/** Normalise a URL string: strip hash, remove redundant trailing slash. */
function normalizeUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return urlStr;
  }
}

function hostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function firstPathSegment(pathname: string): string {
  return pathname.split("/")[1] || "";
}

function isForeignBranch(
  branch: string,
  foreignBranchHits: Map<string, number>,
  acceptedBranches: Set<string>,
): boolean {
  return branch !== "" && (foreignBranchHits.get(branch) ?? 0) >= 2 && !acceptedBranches.has(branch);
}

function addToQueue(
  categoryQueues: Map<string, QueueEntry[]>,
  queuedUrls: Set<string>,
  dirtyQueues: Set<QueueEntry[]>,
  entry: QueueEntry,
  visited: Set<string>,
  hreflangUrlSet: Set<string>,
  targetLang: string | null,
  foreignBranchHits: Map<string, number>,
  acceptedBranches: Set<string>,
  onOtherLanguage: (url: string) => void,
): void {
  if (visited.has(entry.url) || hreflangUrlSet.has(entry.url)) return;
  const pathname = new URL(entry.url).pathname;
  const language = urlLang(pathname);
  const branch = firstPathSegment(pathname);
  if (targetLang && ((language && language !== targetLang) || isForeignBranch(branch, foreignBranchHits, acceptedBranches))) {
    onOtherLanguage(entry.url);
    return;
  }
  if (!categoryQueues.has(entry.category)) categoryQueues.set(entry.category, []);
  const q = categoryQueues.get(entry.category)!;
  if (queuedUrls.has(entry.url)) return;
  queuedUrls.add(entry.url);
  q.push(entry);
  dirtyQueues.add(q);
}

// ─── Known language/region codes for path-based detection ────────────────────

const KNOWN_LANG_CODES = new Set([
  "af", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de",
  "el", "en", "es", "et", "eu", "fa", "fi", "fil", "fr", "ga", "gl", "gu",
  "he", "hi", "hr", "hu", "hy", "id", "is", "it", "ja", "ka", "kk", "km",
  "kn", "ko", "lt", "lv", "mk", "ml", "mn", "mr", "ms", "mt", "nb", "nl",
  "no", "pl", "pt", "ro", "ru", "sk", "sl", "sq", "sr", "sv", "sw", "ta",
  "te", "th", "tr", "uk", "ur", "uz", "vi", "zh",
  // common region variants
  "de-at", "de-ch", "de-de", "en-au", "en-ca", "en-gb", "en-ie", "en-in",
  "en-nz", "en-sg", "en-us", "en-za", "es-419", "es-ar", "es-cl", "es-co",
  "es-es", "es-mx", "fr-be", "fr-ca", "fr-ch", "fr-fr", "it-ch", "it-it",
  "nl-be", "nl-nl", "pt-br", "pt-pt", "zh-cn", "zh-hk", "zh-tw",
]);

function isKnownLangCode(code: string): boolean {
  return KNOWN_LANG_CODES.has(code.toLowerCase());
}

function urlLang(pathname: string): string | null {
  const match = pathname.match(LANG_PREFIX_RE);
  if (!match || !isKnownLangCode(match[1])) return null;
  return match[1].toLowerCase().split("-")[0];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchPage(url: string): Promise<CrawledPage | null> {
  try {
    const data = await fetchWithTiming(url);
    return { url, ...data };
  } catch {
    return null;
  }
}

// ─── Sitemap discovery helpers ────────────────────────────────────────────────

function parseSitemapDeclarations(robotsTxt: string): string[] {
  const urls: string[] = [];
  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.trim();
    if (line.toLowerCase().startsWith("sitemap:")) {
      const u = line.slice("sitemap:".length).trim();
      if (u) urls.push(u);
    }
  }
  return urls;
}

const SITEMAP_MAX_FILES = 100;
const SITEMAP_MAX_URLS = 50_000;
const SITEMAP_MAX_CHARS = 20_000_000;
const SITEMAP_TIME_BUDGET_MS = 25_000;

function sitemapEntries(xml: string): string[] {
  return [...xml.matchAll(/<sitemap\b[^>]*>[\s\S]*?<\/sitemap>/gi)]
    .map(([block]) => block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1].trim())
    .filter((url): url is string => Boolean(url));
}

function prioritizeSitemapEntries(entries: string[], preferredLang: string | null): string[] {
  if (!preferredLang || !/^[a-z]{2,3}$/i.test(preferredLang)) return entries;
  const token = new RegExp(`(^|[^a-z])${preferredLang.toLowerCase()}([^a-z]|$)`);
  const preferred: string[] = [];
  const rest: string[] = [];
  for (const url of entries) {
    let pathAndSearch: string;
    try {
      const parsed = new URL(url);
      pathAndSearch = parsed.pathname + parsed.search;
    } catch {
      pathAndSearch = url;
    }
    (token.test(pathAndSearch.toLowerCase()) ? preferred : rest).push(url);
  }
  return [...preferred, ...rest];
}

async function resolveSitemapIndex(
  indexUrl: string,
  indexXml: string,
  preferredLang: string | null,
): Promise<{ mergedXml: string; resolution: SitemapResolution }> {
  const start = Date.now();
  const topEntries = prioritizeSitemapEntries(sitemapEntries(indexXml), preferredLang);
  const resolution: SitemapResolution = {
    topLevelEntries: topEntries.length, filesRead: 0, filesFailed: 0, filesSkipped: 0,
    nested: false, nestedExample: null, complete: false, pageUrlCount: 0,
    hasImage: false, hasVideo: false,
  };
  const queue = topEntries.map((url) => ({ url, level: 1 }));
  const pages = new Map<string, string | null>();
  let next = 0;
  let filesStarted = 1; // Include the already-fetched top-level index in the file budget.
  let charsRead = indexXml.length;
  let urlCapHit = false;
  let firstNestedOrder = Infinity;

  const inFlight = new Set<Promise<void>>();
  while (next < queue.length || inFlight.size > 0) {
    while (next < queue.length && inFlight.size < 4 &&
           filesStarted < SITEMAP_MAX_FILES && charsRead < SITEMAP_MAX_CHARS &&
           Date.now() - start < SITEMAP_TIME_BUDGET_MS && !urlCapHit) {
      const order = next++;
      const { url, level } = queue[order];
      filesStarted++;
      const work = (async () => {
        try {
          const remaining = SITEMAP_TIME_BUDGET_MS - (Date.now() - start);
          const resp = await fetchWithTiming(url, Math.min(10000, remaining));
          if (resp.statusCode !== 200) {
            resolution.filesFailed++;
            return;
          }
          charsRead += resp.html.length;
          if (/<urlset\b/i.test(resp.html)) {
            resolution.filesRead++;
            resolution.hasImage ||= resp.html.includes("image:") || resp.html.includes("xmlns:image");
            resolution.hasVideo ||= resp.html.includes("video:") || resp.html.includes("xmlns:video");
            for (const [block] of resp.html.matchAll(/<url\b[^>]*>[\s\S]*?<\/url>/gi)) {
              const loc = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i)?.[1].trim();
              if (!loc || pages.has(loc)) continue;
              if (pages.size >= SITEMAP_MAX_URLS) {
                urlCapHit = true;
                break;
              }
              const lastmod = block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i)?.[1].trim() ?? null;
              pages.set(loc, lastmod);
            }
            if (pages.size >= SITEMAP_MAX_URLS) urlCapHit = true;
          } else if (/<sitemapindex\b/i.test(resp.html)) {
            resolution.filesRead++;
            resolution.nested = true;
            const rawChildren = sitemapEntries(resp.html);
            const children = prioritizeSitemapEntries(rawChildren, preferredLang);
            if (order < firstNestedOrder) {
              firstNestedOrder = order;
              resolution.nestedExample = [indexUrl, url, ...(rawChildren.length ? [rawChildren[0]] : [])];
            }
            if (level === 1) {
              queue.splice(next, 0, ...children.map((child) => ({ url: child, level: 2 })));
            } else {
              resolution.filesSkipped++;
            }
          } else {
            resolution.filesFailed++;
          }
        } catch {
          resolution.filesFailed++;
        }
      })();
      inFlight.add(work);
      void work.finally(() => inFlight.delete(work));
    }
    if (inFlight.size === 0) break;
    await Promise.race(inFlight);
  }
  resolution.filesSkipped += queue.length - next;
  resolution.pageUrlCount = pages.size;
  resolution.complete = resolution.filesFailed === 0 && resolution.filesSkipped === 0 && !urlCapHit;
  const lines = [...pages].map(([loc, lastmod]) =>
    `<url><loc>${loc}</loc>${lastmod === null ? "" : `<lastmod>${lastmod}</lastmod>`}</url>`);
  return { mergedXml: `<urlset>\n${lines.join("\n")}\n</urlset>`, resolution };
}

interface SitemapDiscoveryResult {
  sitemapXml: string | null;
  sitemapResolution: SitemapResolution | null;
  htmlSitemapHtml: string | null;
  htmlSitemapUrl: string | null;
  sitemapXmlExists: boolean;
  sitemapType: "xml" | "xml_index" | "html" | "none";
  sitemapStatus: TechnicalFileStatus;
}

async function discoverSitemap(
  origin: string,
  robotsTxt: string | null,
  homepageHtml: string,
  homepageUrl: string,
  preferredLang: string | null,
): Promise<SitemapDiscoveryResult> {
  const none: SitemapDiscoveryResult = {
    sitemapXml: null, sitemapResolution: null, htmlSitemapHtml: null, htmlSitemapUrl: null,
    sitemapXmlExists: false, sitemapType: "none", sitemapStatus: "missing",
  };
  let hadError = false;

  // Step 1: /sitemap.xml
  {
    const fetched = await fetchTechFile(`${origin}/sitemap.xml`, 10000);
    hadError ||= fetched.status === "error";
    const resp = fetched.resp;
    if (fetched.status === "found" && resp) {
      if (resp.html.includes("<urlset")) {
        return { ...none, sitemapXml: resp.html, sitemapXmlExists: true, sitemapType: "xml", sitemapStatus: "found" };
      }
      if (resp.html.includes("<sitemapindex")) {
        const { mergedXml, resolution } = await resolveSitemapIndex(`${origin}/sitemap.xml`, resp.html, preferredLang);
        return { ...none, sitemapXml: mergedXml, sitemapResolution: resolution, sitemapXmlExists: true, sitemapType: "xml_index", sitemapStatus: "found" };
      }
    }
  }

  // Step 2: /sitemap_index.xml
  {
    const fetched = await fetchTechFile(`${origin}/sitemap_index.xml`, 10000);
    hadError ||= fetched.status === "error";
    const resp = fetched.resp;
    if (fetched.status === "found" && resp?.html.includes("<sitemapindex")) {
      const { mergedXml, resolution } = await resolveSitemapIndex(`${origin}/sitemap_index.xml`, resp.html, preferredLang);
      return { ...none, sitemapXml: mergedXml, sitemapResolution: resolution, sitemapXmlExists: true, sitemapType: "xml_index", sitemapStatus: "found" };
    }
  }

  // Step 3: robots.txt Sitemap: declarations
  if (robotsTxt) {
    for (const sitemapUrl of parseSitemapDeclarations(robotsTxt)) {
      try {
        const resp = await fetchWithTiming(sitemapUrl, 10000);
        if (resp.statusCode === 429 || resp.statusCode >= 500) hadError = true;
        if (resp.statusCode === 200) {
          if (resp.html.includes("<sitemapindex")) {
            const { mergedXml, resolution } = await resolveSitemapIndex(sitemapUrl, resp.html, preferredLang);
            return { ...none, sitemapXml: mergedXml, sitemapResolution: resolution, sitemapXmlExists: true, sitemapType: "xml_index", sitemapStatus: "found" };
          }
          if (resp.html.includes("<urlset")) {
            return { ...none, sitemapXml: resp.html, sitemapXmlExists: true, sitemapType: "xml", sitemapStatus: "found" };
          }
        }
      } catch {
        hadError = true;
      }
    }
  }

  // Step 4A: HTML sitemap — known paths
  const htmlPaths = [
    "/sitemap", "/sitemap/", "/sitemap.html", "/sitemap.htm",
    "/sitemap/index.html", "/site-map", "/site-map.html",
    "/sitemaps", "/sitemaps.html", "/de/sitemap", "/en/sitemap",
  ];
  for (const path of htmlPaths) {
    const url = `${origin}${path}`;
    try {
      const resp = await fetchWithTiming(url, 8000);
      if (resp.statusCode === 429 || resp.statusCode >= 500) hadError = true;
      if (resp.statusCode === 200 && resp.html.toLowerCase().includes("<html") && resp.html.length > 500) {
        return { ...none, htmlSitemapHtml: resp.html, htmlSitemapUrl: url, sitemapType: "html", sitemapStatus: "found" };
      }
    } catch {
      hadError = true;
    }
  }

  // Step 4B: HTML sitemap — homepage link search
  if (homepageHtml) {
    const $ = cheerio.load(homepageHtml);
    let foundUrl: string | null = null;
    $("a[href]").each((_, el) => {
      if (foundUrl) return;
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim();
      if (
        href.toLowerCase().includes("sitemap") &&
        /sitemap|site\s*map|seitenübersicht|übersicht/i.test(text)
      ) {
        try { foundUrl = new URL(href, homepageUrl).href; } catch { /* skip */ }
      }
    });
    if (foundUrl) {
      try {
        const resp = await fetchWithTiming(foundUrl, 8000);
        if (resp.statusCode === 429 || resp.statusCode >= 500) hadError = true;
        if (resp.statusCode === 200 && resp.html.toLowerCase().includes("<html") && resp.html.length > 500) {
          return { ...none, htmlSitemapHtml: resp.html, htmlSitemapUrl: foundUrl, sitemapType: "html", sitemapStatus: "found" };
        }
      } catch {
        hadError = true;
      }
    }
  }

  const finalResult = { ...none, sitemapStatus: hadError ? "error" as const : "missing" as const };
  const fields = { file: "Sitemap", url: origin, status: finalResult.sitemapStatus };
  if (finalResult.sitemapStatus === "error") {
    logger.warn(fields, "technical file not retrieved");
  } else {
    logger.info(fields, "technical file not retrieved");
  }
  return finalResult;
}

export async function fetchSiteTechFiles(inputUrl: string): Promise<SiteTechFiles> {
  const base = new URL(inputUrl);
  const result: SiteTechFiles = {
    robotsTxt: null,
    robotsTxtExists: false,
    robotsTxtStatus: "missing",
    llmsTxt: null,
    llmsTxtExists: false,
    llmsTxtStatus: "missing",
    sitemapXml: null,
    sitemapResolution: null,
    sitemapXmlExists: false,
    htmlSitemapHtml: null,
    htmlSitemapUrl: null,
    sitemapType: "none",
    sitemapStatus: "missing",
  };

  const robotsResult = await fetchTechFile(`${base.protocol}//${base.hostname}/robots.txt`, 10000);
  result.robotsTxtStatus = robotsResult.status;
  const robotsResp = robotsResult.resp;
  if (robotsResult.status === "found" && robotsResp && robotsResp.html.length < 100_000) {
    result.robotsTxt = robotsResp.html;
    result.robotsTxtExists = true;
  }

  const llmsResult = await fetchTechFile(`${base.protocol}//${base.hostname}/llms.txt`, 10000);
  result.llmsTxtStatus = llmsResult.status;
  const llmsResp = llmsResult.resp;
  if (llmsResult.status === "found" && llmsResp && llmsResp.html.length > 0 && llmsResp.html.length < 200_000) {
    result.llmsTxt = llmsResp.html;
    result.llmsTxtExists = true;
  }

  let canonicalOrigin = base.origin;
  let canonicalHomepageUrl = inputUrl;
  let homepageHtml = "";
  try {
    const homePage = await fetchWithTiming(inputUrl);
    if (homePage.statusCode < 400) {
      const finalUrl = new URL(homePage.finalUrl);
      if (hostKey(finalUrl.hostname) === hostKey(base.hostname)) {
        canonicalOrigin = finalUrl.origin;
      }
      canonicalHomepageUrl = homePage.finalUrl;
      homepageHtml = homePage.html;
    }
  } catch {
    // Continue sitemap discovery with the input origin and no homepage HTML.
  }

  const sitemap = await discoverSitemap(canonicalOrigin, result.robotsTxt, homepageHtml, canonicalHomepageUrl, homepageHtml ? detectPageLanguage(homepageHtml) : null);
  return { ...result, ...sitemap };
}

export async function fetchExplicitPages(
  inputUrl: string,
  explicitUrls: string[],
  opts?: { onProgress?: (done: number, total: number) => void },
): Promise<CrawlResult> {
  const BATCH_DEADLINE_MS = Math.min(explicitUrls.length * 20_000, 180_000);
  const results: Array<CrawledPage | null> = new Array(explicitUrls.length).fill(null);
  const completed = new Array<boolean>(explicitUrls.length).fill(false);
  const loopStart = Date.now();
  let done = 0;

  for (const [index, pageUrl] of explicitUrls.entries()) {
    if (Date.now() - loopStart >= BATCH_DEADLINE_MS) break;
    results[index] = await fetchPage(pageUrl);
    completed[index] = true;
    opts?.onProgress?.(++done, explicitUrls.length);
  }

  const pages = results.filter(
    (page): page is CrawledPage => page !== null && page.statusCode < 400,
  );
  const result: CrawlResult = {
    pages,
    skipped: { otherLanguage: 0, excludedPath: 0, duplicate: 0, urls: [] },
    timedOut: false,
    robotsTxt: null,
    sitemapXml: null,
    sitemapResolution: null,
    llmsTxt: null,
    htmlSitemapHtml: null,
    htmlSitemapUrl: null,
    sitemapType: "none",
    robotsTxtExists: false,
    sitemapXmlExists: false,
    llmsTxtExists: false,
    hreflangVariants: [],
    reliability: {
      attempted: explicitUrls.length,
      succeeded: pages.length,
      failed: explicitUrls.length - pages.length,
      failures: results.flatMap<CrawlFailure>((page, index) => {
        if (!completed[index]) {
          return [{ url: explicitUrls[index], reason: "timeout" as const }];
        }
        if (page === null) {
          return [{ url: explicitUrls[index], reason: "unknown" as const }];
        }
        if (page.statusCode >= 400) {
          return [{
            url: explicitUrls[index],
            reason: "http_error" as const,
            statusCode: page.statusCode,
          }];
        }
        return [];
      }).slice(0, 25),
    },
  };

  if (pages.length > 0) Object.assign(result, await fetchSiteTechFiles(inputUrl));
  return result;
}

export async function crawlSite(
  inputUrl: string,
  maxPages = 16,
  opts?: { deadlineMs?: number; preferredLang?: string; onProgress?: (done: number, total: number) => void },
): Promise<CrawlResult> {
  const base = new URL(inputUrl);
  const baseDomain = base.hostname;
  const siteKey = hostKey(base.hostname);
  let canonicalProtocol = base.protocol;
  let canonicalHost = base.host;
  const canon = (url: string): string => {
    try {
      const normalized = new URL(normalizeUrl(url));
      if (hostKey(normalized.hostname) === siteKey) {
        normalized.protocol = canonicalProtocol;
        normalized.host = canonicalHost;
      }
      return normalized.href;
    } catch {
      return url;
    }
  };
  const CRAWL_DEADLINE_MS = opts?.deadlineMs ?? 90_000;
  const crawlStart = Date.now();
  // Rule 4: path ceiling — normalise to no trailing slash
  const startPath = base.pathname.replace(/\/+$/, "") || "/";

  const result: CrawlResult = {
    pages: [],
    skipped: { otherLanguage: 0, excludedPath: 0, duplicate: 0, urls: [] },
    homepageFailReason: null,
    timedOut: false,
    robotsTxt: null,
    sitemapXml: null,
    llmsTxt: null,
    htmlSitemapHtml: null,
    htmlSitemapUrl: null,
    sitemapType: "none",
    robotsTxtExists: false,
    sitemapXmlExists: false,
    llmsTxtExists: false,
    robotsTxtStatus: "missing",
    sitemapStatus: "missing",
    llmsTxtStatus: "missing",
    hreflangVariants: [],
    reliability: { attempted: 0, succeeded: 0, failed: 0, failures: [] },
  };
  const excludedPathUrls = new Set<string>();
  const seenFingerprints = new Map<string, string>();
  const recordExcludedPath = (url: string) => {
    if (excludedPathUrls.has(url)) return;
    excludedPathUrls.add(url);
    result.skipped.excludedPath++;
    if (result.skipped.urls.length < 10) result.skipped.urls.push(url);
  };
  const skippedLanguagePages: CrawledPage[] = [];
  const skippedLanguageUrls = new Set<string>();
  const foreignBranchHits = new Map<string, number>();
  const acceptedBranches = new Set<string>();
  const recordOtherLanguage = (url: string) => {
    if (skippedLanguageUrls.has(url)) return;
    skippedLanguageUrls.add(url);
    result.skipped.otherLanguage++;
    if (result.skipped.urls.length < 10) result.skipped.urls.push(url);
  };
  let targetLang: string | null = null;

  function recordFailure(url: string, reason: CrawlFailReason, statusCode?: number) {
    result.reliability.failed++;
    if (result.reliability.failures.length < 25) {
      result.reliability.failures.push({
        url,
        reason,
        ...(statusCode !== undefined ? { statusCode } : {}),
      });
    }
  }

  // ── robots.txt ────────────────────────────────────────────────────────────
  {
    const robotsResult = await fetchTechFile(`${base.protocol}//${baseDomain}/robots.txt`, 10000);
    result.robotsTxtStatus = robotsResult.status;
    const robotsResp = robotsResult.resp;
    if (robotsResult.status === "found" && robotsResp && robotsResp.html.length < 100_000) {
      result.robotsTxt = robotsResp.html;
      result.robotsTxtExists = true;
    }
  }

  // ── llms.txt ──────────────────────────────────────────────────────────────
  {
    const llmsResult = await fetchTechFile(`${base.protocol}//${baseDomain}/llms.txt`, 10000);
    result.llmsTxtStatus = llmsResult.status;
    const llmsResp = llmsResult.resp;
    if (
      llmsResult.status === "found" &&
      llmsResp &&
      llmsResp.html.length > 0 &&
      llmsResp.html.length < 200_000
    ) {
      result.llmsTxt = llmsResp.html;
      result.llmsTxtExists = true;
    }
  }

  const visited = new Set<string>();
  const hreflangUrlSet = new Set<string>();

  // When the start path already contains a language prefix (e.g. /de, /en),
  // hreflang alternates within that same prefix are valid content pages —
  // do NOT quarantine them (Rule 4 already blocks other-language URLs).
  // When the start path is at the root (/), quarantine ALL hreflang URLs to
  // prevent the crawler from wasting budget on language duplicates.
  const startPathHasLangPrefix = LANG_PREFIX_RE.test(startPath + "/");

  function quarantineHreflang(variants: HreflangVariant[]): void {
    for (const v of variants) {
      // Always store for display
      if (!result.hreflangVariants.some((h) => h.url === v.url && h.lang === v.lang)) {
        result.hreflangVariants.push(v);
      }
      // Only block URLs that fall outside our crawl scope
      const canonicalVariantUrl = canon(v.url);
      if (startPathHasLangPrefix) {
        // Crawl scope = startPath; block only URLs outside it
        try {
          const vPath = new URL(canonicalVariantUrl).pathname;
          if (!isWithinStartPath(vPath, startPath)) {
            hreflangUrlSet.add(canonicalVariantUrl);
          }
        } catch {
          hreflangUrlSet.add(canonicalVariantUrl);
        }
      } else {
        // Root-level crawl: block all hreflang alternates to avoid language sprawl
        hreflangUrlSet.add(canonicalVariantUrl);
      }
    }
  }

  // Per-category queues (Rule 5 data structure)
  const categoryQueues = new Map<string, QueueEntry[]>();
  const queuedUrls = new Set<string>();
  const dirtyQueues = new Set<QueueEntry[]>();
  // Per-category crawl counts for the 25% cap (Rule 1)
  const categoryCounts = new Map<string, number>();

  // ── Step 1: Fetch homepage first (special — always crawl it) ──────────────
  const homepageUrl = inputUrl;
  visited.add(canon(homepageUrl));

  let homepageHtml = "";
  let canonicalHomepageUrl = canon(homepageUrl);
  result.reliability.attempted++;
  try {
    const homePage = await fetchWithTiming(homepageUrl);
    try {
      const finalUrl = new URL(homePage.finalUrl);
      if (hostKey(finalUrl.hostname) === siteKey) {
        canonicalProtocol = finalUrl.protocol;
        canonicalHost = finalUrl.host;
      }
    } catch {
      // Keep the input origin.
    }
    canonicalHomepageUrl = canon(homePage.finalUrl);
    visited.add(canonicalHomepageUrl);
    homepageHtml = homePage.html;
    const preferred = opts?.preferredLang ?? detectPageLanguage(homepageHtml);
    targetLang = preferred === "de" || preferred === "en" ? preferred : null;
    const blocked = detectBlockedContent(homepageHtml);
    if (homePage.statusCode < 400 && blocked === null) {
      const fingerprint = contentFingerprint(homepageHtml);
      if (fingerprint) seenFingerprints.set(fingerprint, canonicalHomepageUrl);
      result.pages.push({
        url: canonicalHomepageUrl,
        html: homepageHtml,
        statusCode: homePage.statusCode,
        responseTime: homePage.responseTime,
        ttfb: homePage.ttfb,
      });
      acceptedBranches.add(firstPathSegment(new URL(canonicalHomepageUrl).pathname));
      result.reliability.succeeded++;
      opts?.onProgress?.(result.pages.length, maxPages);
    } else {
      const reason = blocked ?? classifyHttpStatus(homePage.statusCode);
      recordFailure(canonicalHomepageUrl, reason, homePage.statusCode);
      result.homepageFailReason = reason;
      logger.warn(
        { url: canonicalHomepageUrl, reason, statusCode: homePage.statusCode },
        "Homepage could not be analysed",
      );
      return result;
    }

    // Quarantine hreflang variants found on homepage
    quarantineHreflang(extractHreflangVariants(homepageHtml, canonicalHomepageUrl));

    // Count homepage in __root__ category
    categoryCounts.set("__root__", 1);
  } catch (err) {
    const reason = classifyFetchError(err);
    canonicalHomepageUrl = canon(homepageUrl);
    recordFailure(canonicalHomepageUrl, reason);
    result.homepageFailReason = reason;
    logger.warn({ url: canonicalHomepageUrl, reason, err }, "Failed to fetch homepage");
    if (
      reason === "dns" ||
      reason === "refused" ||
      reason === "tls_chain" ||
      reason === "tls_other"
    ) {
      return result;
    }
  }

  // ── Sitemap discovery waterfall (steps 1–4) ───────────────────────────────
  {
    const origin = `${canonicalProtocol}//${canonicalHost}`;
    const sd = await discoverSitemap(origin, result.robotsTxt, homepageHtml, canonicalHomepageUrl, targetLang);
    result.sitemapXml = sd.sitemapXml;
    result.sitemapResolution = sd.sitemapResolution;
    result.sitemapXmlExists = sd.sitemapXmlExists;
    result.htmlSitemapHtml = sd.htmlSitemapHtml;
    result.htmlSitemapUrl = sd.htmlSitemapUrl;
    result.sitemapType = sd.sitemapType;
    result.sitemapStatus = sd.sitemapStatus;
  }

  // ── Step 2: Collect all initial candidates from homepage links + sitemap ──
  //           (Rule 5 Step 1+2+3+4)

  // Homepage links
  if (homepageHtml) {
    const links = extractInternalLinks(
      homepageHtml,
      canonicalHomepageUrl,
      siteKey,
      canon,
      startPath,
      hreflangUrlSet,
      recordExcludedPath,
    );
    for (const { url } of links) {
      addToQueue(categoryQueues, queuedUrls, dirtyQueues, makeEntry(url, startPath), visited, hreflangUrlSet, targetLang, foreignBranchHits, acceptedBranches, recordOtherLanguage);
    }
  }

  // Sitemap URLs — apply same filtering
  if (result.sitemapXml) {
    const sitemapUrls = parseSitemapUrls(result.sitemapXml, siteKey, canon);
    for (const u of sitemapUrls) {
      try {
        const parsed = new URL(u);
        if (!isWithinStartPath(parsed.pathname, startPath)) continue;
        if (EXCLUDED_KEYWORD_PATTERN.test(u)) {
          recordExcludedPath(u);
          continue;
        }
        if (scoreUrl(u) === 0) continue;
        if (hreflangUrlSet.has(u)) continue;
        addToQueue(categoryQueues, queuedUrls, dirtyQueues, makeEntry(u, startPath), visited, hreflangUrlSet, targetLang, foreignBranchHits, acceptedBranches, recordOtherLanguage);
      } catch {
        // skip
      }
    }
  }

  // ── Main round-robin crawl loop (Rules 1, 2, 3, 5) ───────────────────────
  //
  // Cap (Rule 1): recomputed each iteration so newly discovered categories
  // are included.  25% cap when ≥4 distinct categories, 40% otherwise.
  //
  // Round-robin (Rule 5): prefer the least-crawled eligible category; within
  // a tied count, prefer higher content score then shallower depth.
  //
  // Bulletproof cap: before scoring each category queue, flush any entries
  // that are already visited or hreflang-quarantined from the front.  This
  // guarantees we never "use up" a pick on a URL we would immediately skip,
  // which would silently allow a category to exceed its cap.

  let pagesLeft = maxPages - result.pages.length; // homepage already in result

  while (pagesLeft > 0 && result.reliability.attempted < maxPages + EXTRA_FETCH_ALLOWANCE) {
    if (Date.now() - crawlStart > CRAWL_DEADLINE_MS) {
      result.timedOut = true;
      break;
    }

    // Recompute cap using all known category keys
    const allCats = new Set([...categoryQueues.keys(), ...categoryCounts.keys()]);
    const numCats = Math.max(1, allCats.size);
    const capPct = numCats < 4 ? 0.4 : 0.25;
    const maxPerCat = Math.max(1, Math.ceil(maxPages * capPct));

    let bestCat: string | null = null;
    let bestEntry: QueueEntry | null = null;
    let bestScore = -Infinity;

    for (const queue of dirtyQueues) sortCategoryQueue(queue);
    dirtyQueues.clear();
    for (const [cat, queue] of categoryQueues) {
      // Flush stale (visited / quarantined) entries from the front
      while (queue.length > 0 && (visited.has(queue[0].url) || hreflangUrlSet.has(queue[0].url))) {
        queue.shift();
      }
      if (queue.length === 0) continue;

      const crawled = categoryCounts.get(cat) ?? 0;
      if (crawled >= maxPerCat) continue; // hard cap (Rule 1)

      const top = queue[0];
      const saturation = crawled / maxPerCat;
      // Round-robin: heavy penalty for already-crawled categories so the
      // least-crawled category is consistently preferred (Rule 2 + Rule 5).
      const score =
        top.contentScore + top.langPriority * 10 - top.depth * 3 - saturation * 200;

      if (score > bestScore) {
        bestScore = score;
        bestCat = cat;
        bestEntry = top;
      }
    }

    if (!bestCat || !bestEntry) break; // no eligible URLs remain

    // Remove chosen entry from its queue (front is guaranteed non-visited)
    categoryQueues.get(bestCat)!.shift();
    const url = bestEntry.url;
    visited.add(url);

    const pathname = new URL(url).pathname;
    const branch = firstPathSegment(pathname);
    if (targetLang && isForeignBranch(branch, foreignBranchHits, acceptedBranches)) {
      recordOtherLanguage(url);
      continue;
    }

    result.reliability.attempted++;
    try {
      const page = await fetchWithTiming(url);
      const blocked = detectBlockedContent(page.html);
      if (page.statusCode < 400 && blocked === null) {
        const crawledPage: CrawledPage = {
          url,
          html: page.html,
          statusCode: page.statusCode,
          responseTime: page.responseTime,
          ttfb: page.ttfb,
        };
        result.reliability.succeeded++;
        const urlLanguage = targetLang ? urlLang(pathname) : null;
        const lang = targetLang ? urlLanguage ?? detectPageLanguage(page.html) : null;
        if (targetLang && lang && lang !== targetLang) {
          recordOtherLanguage(url);
          skippedLanguagePages.push(crawledPage);
          if (!urlLanguage && url !== homepageUrl && url !== canonicalHomepageUrl && branch) {
            foreignBranchHits.set(branch, (foreignBranchHits.get(branch) ?? 0) + 1);
          }
          continue;
        }
        const fingerprint = contentFingerprint(page.html);
        const originalUrl = fingerprint ? seenFingerprints.get(fingerprint) : undefined;
        if (originalUrl) {
          result.skipped.duplicate++;
          if (result.skipped.urls.length < 10) result.skipped.urls.push(url);
          logger.debug({ url, originalUrl }, "duplicate page skipped");
          continue;
        }
        if (fingerprint) seenFingerprints.set(fingerprint, url);
        result.pages.push(crawledPage);
        acceptedBranches.add(branch);
        pagesLeft--;
        opts?.onProgress?.(result.pages.length, maxPages);

        // Update category count immediately after successful crawl
        const prevCount = categoryCounts.get(bestCat) ?? 0;
        categoryCounts.set(bestCat, prevCount + 1);

        logger.debug(
          { category: bestCat, count: prevCount + 1, maxPerCat, numCats, url },
          "crawled page",
        );

        // Quarantine hreflang variants from this page
        quarantineHreflang(extractHreflangVariants(page.html, url));

        // Discover new links and add to per-category queues (Rule 5 Step 5)
        if (pagesLeft > 0) {
          const links = extractInternalLinks(page.html, url, siteKey, canon, startPath, hreflangUrlSet, recordExcludedPath);
          for (const { url: linkUrl } of links) {
            addToQueue(categoryQueues, queuedUrls, dirtyQueues, makeEntry(linkUrl, startPath), visited, hreflangUrlSet, targetLang, foreignBranchHits, acceptedBranches, recordOtherLanguage);
          }
        }
      } else {
        recordFailure(url, blocked ?? classifyHttpStatus(page.statusCode), page.statusCode);
      }
    } catch (err) {
      const reason = classifyFetchError(err);
      recordFailure(url, reason);
      logger.warn({ url, reason, err }, "Failed to crawl page");
    }
  }

  if (result.pages.length < 2 && skippedLanguagePages.length > 0) {
    const added = Math.min(2 - result.pages.length, skippedLanguagePages.length);
    const fallbackPages = skippedLanguagePages.slice(0, added);
    result.pages.push(...fallbackPages);
    for (const page of fallbackPages) {
      acceptedBranches.add(firstPathSegment(new URL(page.url).pathname));
    }
    opts?.onProgress?.(result.pages.length, maxPages);
    logger.warn({ targetLang, added }, "language filter relaxed");
  }

  // ── A2: Path-based language fallback ─────────────────────────────────────
  // If no hreflang tags were found at all, infer language variants from the
  // path prefixes of the URLs we actually visited during the crawl.
  // Pattern: /<langcode>/ or /<langcode> at end of pathname (e.g. /en, /de-at)
  const LANG_SEGMENT_RE = /^\/([a-z]{2,3}(?:-[a-z]{2,4})?)(?:\/|$)/i;

  // Collect all candidate URLs: crawled pages + hreflang-quarantined URLs
  const candidateUrls = [
    ...result.pages.map((p) => p.url),
    ...Array.from(hreflangUrlSet),
  ];

  for (const candidateUrl of candidateUrls) {
    try {
      const pathname = new URL(candidateUrl).pathname;
      const m = pathname.match(LANG_SEGMENT_RE);
      if (!m) continue;
      const lang = m[1].toLowerCase();
      // Only treat as a language segment if it looks like a real ISO code
      // (skip path segments that happen to be 2-3 chars, e.g. /de for a topic)
      // We check against a known list of common language/region codes.
      if (!isKnownLangCode(lang)) continue;

      // Normalise: use the root of that language path as the variant URL
      const u = new URL(candidateUrl);
      u.pathname = `/${lang}/`;
      u.search = "";
      u.hash = "";
      const variantUrl = u.href;

      // Add as an inferred variant if not already present
      const alreadyExists = result.hreflangVariants.some(
        (h) => h.lang === lang || h.url === variantUrl,
      );
      if (!alreadyExists) {
        result.hreflangVariants.push({ lang, url: variantUrl });
      }
    } catch {
      // skip
    }
  }

  // Sort hreflang results: x-default first, then alphabetically
  result.hreflangVariants.sort((a, b) => {
    if (a.lang === "x-default") return -1;
    if (b.lang === "x-default") return 1;
    return a.lang.localeCompare(b.lang);
  });

  logger.info(
    {
      pages: result.pages.length,
      categories: [...categoryCounts.entries()].map(([k, v]) => `${k}:${v}`).join(", "),
    },
    "Crawl complete",
  );

  return result;
}
