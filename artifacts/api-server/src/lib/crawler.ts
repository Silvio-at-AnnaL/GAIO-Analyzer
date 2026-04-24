import * as cheerio from "cheerio";
import { logger } from "./logger";

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

export interface CrawlResult {
  pages: CrawledPage[];
  robotsTxt: string | null;
  sitemapXml: string | null;
  robotsTxtExists: boolean;
  sitemapXmlExists: boolean;
  hreflangVariants: HreflangVariant[];
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
  /login|logout|cart|warenkorb|checkout|impressum|datenschutz|privacy|cookie|agb|terms|sitemap|feed|rss|wp-admin|wp-json/i;

const EXCLUDED_EXTENSION_PATTERN = /\.(pdf|jpg|jpeg|png|gif|svg|mp4|zip|css|js)(\?|$)/i;

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
): Promise<{ html: string; statusCode: number; responseTime: number; ttfb: number }> {
  const start = Date.now();
  let ttfb = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
    return { html, statusCode: response.status, responseTime: Date.now() - start, ttfb };
  } finally {
    clearTimeout(timer);
  }
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
  baseDomain: string,
  startPath: string,
  excludedUrls: Set<string>,
): Array<{ url: string }> {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: Array<{ url: string }> = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== baseDomain) return;
      if (!resolved.protocol.startsWith("http")) return;

      const url = normalizeUrl(resolved.href);

      if (seen.has(url)) return;
      seen.add(url);
      if (excludedUrls.has(url)) return;

      // Rule 4: path ceiling
      const pathname = new URL(url).pathname;
      if (!isWithinStartPath(pathname, startPath)) return;

      // Score must be non-zero (excludes blacklisted/binary URLs)
      if (scoreUrl(url) === 0) return;

      results.push({ url });
    } catch {
      // skip
    }
  });

  return results;
}

function parseSitemapUrls(xml: string, hostname: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>(.*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null) {
    try {
      const url = new URL(match[1].trim());
      if (url.hostname === hostname) urls.push(url.href);
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

function addToQueue(
  categoryQueues: Map<string, QueueEntry[]>,
  entry: QueueEntry,
  visited: Set<string>,
  hreflangUrlSet: Set<string>,
): void {
  if (visited.has(entry.url) || hreflangUrlSet.has(entry.url)) return;
  if (!categoryQueues.has(entry.category)) categoryQueues.set(entry.category, []);
  const q = categoryQueues.get(entry.category)!;
  if (q.some((e) => e.url === entry.url)) return;
  q.push(entry);
  sortCategoryQueue(q);
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

export async function crawlSite(inputUrl: string, maxPages = 16): Promise<CrawlResult> {
  const base = new URL(inputUrl);
  const baseDomain = base.hostname;
  // Rule 4: path ceiling — normalise to no trailing slash
  const startPath = base.pathname.replace(/\/+$/, "") || "/";

  const result: CrawlResult = {
    pages: [],
    robotsTxt: null,
    sitemapXml: null,
    robotsTxtExists: false,
    sitemapXmlExists: false,
    hreflangVariants: [],
  };

  // ── robots.txt ────────────────────────────────────────────────────────────
  try {
    const robotsResp = await fetchWithTiming(
      `${base.protocol}//${baseDomain}/robots.txt`,
      5000,
    );
    if (robotsResp.statusCode === 200 && robotsResp.html.length < 100_000) {
      result.robotsTxt = robotsResp.html;
      result.robotsTxtExists = true;
    }
  } catch {
    logger.debug("robots.txt not accessible");
  }

  // ── sitemap.xml ───────────────────────────────────────────────────────────
  try {
    const sitemapResp = await fetchWithTiming(
      `${base.protocol}//${baseDomain}/sitemap.xml`,
      5000,
    );
    if (sitemapResp.statusCode === 200 && sitemapResp.html.includes("<urlset")) {
      result.sitemapXml = sitemapResp.html;
      result.sitemapXmlExists = true;
    }
  } catch {
    logger.debug("sitemap.xml not accessible");
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
      if (startPathHasLangPrefix) {
        // Crawl scope = startPath; block only URLs outside it
        try {
          const vPath = new URL(v.url).pathname;
          if (!isWithinStartPath(vPath, startPath)) {
            hreflangUrlSet.add(v.url);
          }
        } catch {
          hreflangUrlSet.add(v.url);
        }
      } else {
        // Root-level crawl: block all hreflang alternates to avoid language sprawl
        hreflangUrlSet.add(v.url);
      }
    }
  }

  // Per-category queues (Rule 5 data structure)
  const categoryQueues = new Map<string, QueueEntry[]>();
  // Per-category crawl counts for the 25% cap (Rule 1)
  const categoryCounts = new Map<string, number>();

  // ── Step 1: Fetch homepage first (special — always crawl it) ──────────────
  const homepageUrl = inputUrl;
  visited.add(homepageUrl);

  let homepageHtml = "";
  try {
    const homePage = await fetchWithTiming(homepageUrl);
    homepageHtml = homePage.html;
    result.pages.push({
      url: homepageUrl,
      html: homepageHtml,
      statusCode: homePage.statusCode,
      responseTime: homePage.responseTime,
      ttfb: homePage.ttfb,
    });

    // Quarantine hreflang variants found on homepage
    quarantineHreflang(extractHreflangVariants(homepageHtml, homepageUrl));

    // Count homepage in __root__ category
    categoryCounts.set("__root__", 1);
  } catch (err) {
    logger.warn({ url: homepageUrl, err }, "Failed to fetch homepage");
  }

  // ── Step 2: Collect all initial candidates from homepage links + sitemap ──
  //           (Rule 5 Step 1+2+3+4)

  // Homepage links
  if (homepageHtml) {
    const links = extractInternalLinks(
      homepageHtml,
      homepageUrl,
      baseDomain,
      startPath,
      hreflangUrlSet,
    );
    for (const { url } of links) {
      addToQueue(categoryQueues, makeEntry(url, startPath), visited, hreflangUrlSet);
    }
  }

  // Sitemap URLs — apply same filtering
  if (result.sitemapXml) {
    const sitemapUrls = parseSitemapUrls(result.sitemapXml, baseDomain);
    for (const u of sitemapUrls) {
      try {
        const parsed = new URL(u);
        if (!isWithinStartPath(parsed.pathname, startPath)) continue;
        if (scoreUrl(u) === 0) continue;
        if (hreflangUrlSet.has(u)) continue;
        addToQueue(categoryQueues, makeEntry(u, startPath), visited, hreflangUrlSet);
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

  while (pagesLeft > 0) {
    // Recompute cap using all known category keys
    const allCats = new Set([...categoryQueues.keys(), ...categoryCounts.keys()]);
    const numCats = Math.max(1, allCats.size);
    const capPct = numCats < 4 ? 0.4 : 0.25;
    const maxPerCat = Math.max(1, Math.ceil(maxPages * capPct));

    let bestCat: string | null = null;
    let bestEntry: QueueEntry | null = null;
    let bestScore = -Infinity;

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

    try {
      const page = await fetchWithTiming(url);
      result.pages.push({
        url,
        html: page.html,
        statusCode: page.statusCode,
        responseTime: page.responseTime,
        ttfb: page.ttfb,
      });
      pagesLeft--;

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
        const links = extractInternalLinks(page.html, url, baseDomain, startPath, hreflangUrlSet);
        for (const { url: linkUrl } of links) {
          addToQueue(categoryQueues, makeEntry(linkUrl, startPath), visited, hreflangUrlSet);
        }
      }
    } catch (err) {
      logger.warn({ url, err }, "Failed to crawl page");
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
