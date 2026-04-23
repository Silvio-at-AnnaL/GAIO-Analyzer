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

// ─── Priority scoring ────────────────────────────────────────────────────────

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

function scoreUrl(url: string): number {
  if (EXCLUDED_KEYWORD_PATTERN.test(url)) return 0;
  if (EXCLUDED_EXTENSION_PATTERN.test(url)) return 0;
  if (EXCLUDED_TRACKING_PARAMS.test(url)) return 0;
  for (const { score, pattern } of PRIORITY_PATTERNS) {
    if (pattern.test(url)) return score;
  }
  return 20;
}

// ─── Fetching ────────────────────────────────────────────────────────────────

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
    const responseTime = Date.now() - start;

    return { html, statusCode: response.status, responseTime, ttfb };
  } finally {
    clearTimeout(timer);
  }
}

// ─── HTML parsing helpers ────────────────────────────────────────────────────

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
      // skip invalid
    }
  });

  return variants;
}

function extractInternalLinks(
  html: string,
  baseUrl: string,
  excludedUrls: Set<string>,
): Array<{ url: string; score: number }> {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const results: Array<{ url: string; score: number }> = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) return;
      if (!resolved.protocol.startsWith("http")) return;

      resolved.hash = "";
      const url = resolved.href;

      if (seen.has(url)) return;
      seen.add(url);

      if (excludedUrls.has(url)) return;

      const score = scoreUrl(url);
      if (score === 0) return;

      results.push({ url, score });
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
      if (url.hostname === hostname) {
        urls.push(url.href);
      }
    } catch {
      // skip
    }
  }
  return urls;
}

// ─── Public API ──────────────────────────────────────────────────────────────

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
  const result: CrawlResult = {
    pages: [],
    robotsTxt: null,
    sitemapXml: null,
    robotsTxtExists: false,
    sitemapXmlExists: false,
    hreflangVariants: [],
  };

  // Fetch robots.txt
  try {
    const robotsUrl = `${base.protocol}//${base.hostname}/robots.txt`;
    const robotsResp = await fetchWithTiming(robotsUrl, 5000);
    if (robotsResp.statusCode === 200 && robotsResp.html.length < 100000) {
      result.robotsTxt = robotsResp.html;
      result.robotsTxtExists = true;
    }
  } catch {
    logger.debug("robots.txt not accessible");
  }

  // Fetch sitemap.xml
  try {
    const sitemapUrl = `${base.protocol}//${base.hostname}/sitemap.xml`;
    const sitemapResp = await fetchWithTiming(sitemapUrl, 5000);
    if (sitemapResp.statusCode === 200 && sitemapResp.html.includes("<urlset")) {
      result.sitemapXml = sitemapResp.html;
      result.sitemapXmlExists = true;
    }
  } catch {
    logger.debug("sitemap.xml not accessible");
  }

  const visited = new Set<string>();
  const hreflangUrlSet = new Set<string>(); // never crawl these

  // Priority queue: array of {url, score} sorted descending by score
  const queue: Array<{ url: string; score: number }> = [{ url: inputUrl, score: 999 }];

  // Seed from sitemap with priority scoring
  if (result.sitemapXml) {
    const sitemapUrls = parseSitemapUrls(result.sitemapXml, base.hostname);
    for (const u of sitemapUrls) {
      const s = scoreUrl(u);
      if (s > 0 && !queue.some((q) => q.url === u)) {
        queue.push({ url: u, score: s });
      }
    }
    // Sort sitemap-seeded queue by priority (homepage stays first at index 0)
    const [home, ...rest] = queue;
    rest.sort((a, b) => b.score - a.score);
    queue.length = 0;
    queue.push(home, ...rest);
  }

  while (queue.length > 0 && result.pages.length < maxPages) {
    // Pop highest priority item
    queue.sort((a, b) => b.score - a.score);
    const { url } = queue.shift()!;

    const normalized = new URL(url);
    normalized.hash = "";
    const key = normalized.href;

    if (visited.has(key)) continue;
    if (hreflangUrlSet.has(key)) continue;
    visited.add(key);

    try {
      const page = await fetchWithTiming(url);
      result.pages.push({
        url,
        html: page.html,
        statusCode: page.statusCode,
        responseTime: page.responseTime,
        ttfb: page.ttfb,
      });

      // Extract and quarantine hreflang variants from this page
      const variants = extractHreflangVariants(page.html, url);
      for (const v of variants) {
        hreflangUrlSet.add(v.url);
        // Add to result if not already present
        if (!result.hreflangVariants.some((h) => h.url === v.url && h.lang === v.lang)) {
          result.hreflangVariants.push(v);
        }
      }

      // Discover new links for the queue
      if (result.pages.length < maxPages) {
        const links = extractInternalLinks(page.html, url, hreflangUrlSet);
        for (const { url: linkUrl, score } of links) {
          if (!visited.has(linkUrl) && !hreflangUrlSet.has(linkUrl) && !queue.some((q) => q.url === linkUrl)) {
            queue.push({ url: linkUrl, score });
          }
        }
      }
    } catch (err) {
      logger.warn({ url, err }, "Failed to crawl page");
    }
  }

  // Sort hreflang variants: x-default first, then alphabetically by lang
  result.hreflangVariants.sort((a, b) => {
    if (a.lang === "x-default") return -1;
    if (b.lang === "x-default") return 1;
    return a.lang.localeCompare(b.lang);
  });

  return result;
}
