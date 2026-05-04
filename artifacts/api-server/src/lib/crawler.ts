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
  llmsTxt: string | null;
  htmlSitemapHtml: string | null;
  htmlSitemapUrl: string | null;
  sitemapType: "xml" | "xml_index" | "html" | "none";
  robotsTxtExists: boolean;
  sitemapXmlExists: boolean;
  llmsTxtExists: boolean;
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

async function fetchSitemapIndexChildren(indexXml: string): Promise<string | null> {
  const childUrls: string[] = [];
  const locRe = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = locRe.exec(indexXml)) !== null && childUrls.length < 5) {
    childUrls.push(m[1].trim());
  }
  if (childUrls.length === 0) return null;

  const allLocs: string[] = [];
  await Promise.allSettled(
    childUrls.map(async (childUrl) => {
      try {
        const resp = await fetchWithTiming(childUrl, 5000);
        if (resp.statusCode === 200 && resp.html.includes("<urlset")) {
          const matches = [...resp.html.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)];
          allLocs.push(...matches.map((x) => x[1].trim()));
        }
      } catch {
        // skip
      }
    }),
  );

  if (allLocs.length === 0) return null;
  return `<urlset>\n${allLocs.map((u) => `<url><loc>${u}</loc></url>`).join("\n")}\n</urlset>`;
}

interface SitemapDiscoveryResult {
  sitemapXml: string | null;
  htmlSitemapHtml: string | null;
  htmlSitemapUrl: string | null;
  sitemapXmlExists: boolean;
  sitemapType: "xml" | "xml_index" | "html" | "none";
}

async function discoverSitemap(
  origin: string,
  robotsTxt: string | null,
  homepageHtml: string,
  homepageUrl: string,
): Promise<SitemapDiscoveryResult> {
  const none: SitemapDiscoveryResult = {
    sitemapXml: null, htmlSitemapHtml: null, htmlSitemapUrl: null,
    sitemapXmlExists: false, sitemapType: "none",
  };

  // Step 1: /sitemap.xml
  try {
    const resp = await fetchWithTiming(`${origin}/sitemap.xml`, 5000);
    if (resp.statusCode === 200) {
      if (resp.html.includes("<urlset")) {
        return { ...none, sitemapXml: resp.html, sitemapXmlExists: true, sitemapType: "xml" };
      }
      if (resp.html.includes("<sitemapindex")) {
        const merged = await fetchSitemapIndexChildren(resp.html);
        return { ...none, sitemapXml: merged ?? resp.html, sitemapXmlExists: true, sitemapType: "xml_index" };
      }
    }
  } catch {
    logger.debug("sitemap.xml not accessible");
  }

  // Step 2: /sitemap_index.xml
  try {
    const resp = await fetchWithTiming(`${origin}/sitemap_index.xml`, 5000);
    if (resp.statusCode === 200 && resp.html.includes("<sitemapindex")) {
      const merged = await fetchSitemapIndexChildren(resp.html);
      return { ...none, sitemapXml: merged ?? resp.html, sitemapXmlExists: true, sitemapType: "xml_index" };
    }
  } catch {
    logger.debug("sitemap_index.xml not accessible");
  }

  // Step 3: robots.txt Sitemap: declarations
  if (robotsTxt) {
    for (const sitemapUrl of parseSitemapDeclarations(robotsTxt)) {
      try {
        const resp = await fetchWithTiming(sitemapUrl, 5000);
        if (resp.statusCode === 200) {
          if (resp.html.includes("<sitemapindex")) {
            const merged = await fetchSitemapIndexChildren(resp.html);
            return { ...none, sitemapXml: merged ?? resp.html, sitemapXmlExists: true, sitemapType: "xml_index" };
          }
          if (resp.html.includes("<urlset")) {
            return { ...none, sitemapXml: resp.html, sitemapXmlExists: true, sitemapType: "xml" };
          }
        }
      } catch {
        // skip
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
      const resp = await fetchWithTiming(url, 3000);
      if (resp.statusCode === 200 && resp.html.toLowerCase().includes("<html") && resp.html.length > 500) {
        return { ...none, htmlSitemapHtml: resp.html, htmlSitemapUrl: url, sitemapType: "html" };
      }
    } catch {
      // skip
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
        const resp = await fetchWithTiming(foundUrl, 3000);
        if (resp.statusCode === 200 && resp.html.toLowerCase().includes("<html") && resp.html.length > 500) {
          return { ...none, htmlSitemapHtml: resp.html, htmlSitemapUrl: foundUrl, sitemapType: "html" };
        }
      } catch {
        // skip
      }
    }
  }

  return none;
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
    llmsTxt: null,
    htmlSitemapHtml: null,
    htmlSitemapUrl: null,
    sitemapType: "none",
    robotsTxtExists: false,
    sitemapXmlExists: false,
    llmsTxtExists: false,
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

  // ── llms.txt ──────────────────────────────────────────────────────────────
  try {
    const llmsResp = await fetchWithTiming(
      `${base.protocol}//${baseDomain}/llms.txt`,
      5000,
    );
    if (llmsResp.statusCode === 200 && llmsResp.html.length > 0 && llmsResp.html.length < 200_000) {
      result.llmsTxt = llmsResp.html;
      result.llmsTxtExists = true;
    }
  } catch {
    logger.debug("llms.txt not accessible");
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

  // ── Sitemap discovery waterfall (steps 1–4) ───────────────────────────────
  {
    const origin = `${base.protocol}//${baseDomain}`;
    const sd = await discoverSitemap(origin, result.robotsTxt, homepageHtml, homepageUrl);
    result.sitemapXml = sd.sitemapXml;
    result.sitemapXmlExists = sd.sitemapXmlExists;
    result.htmlSitemapHtml = sd.htmlSitemapHtml;
    result.htmlSitemapUrl = sd.htmlSitemapUrl;
    result.sitemapType = sd.sitemapType;
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
