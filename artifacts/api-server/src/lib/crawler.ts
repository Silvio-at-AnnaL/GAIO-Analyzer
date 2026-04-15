import * as cheerio from "cheerio";
import { logger } from "./logger";

export interface CrawledPage {
  url: string;
  html: string;
  statusCode: number;
  responseTime: number;
  ttfb: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  robotsTxt: string | null;
  sitemapXml: string | null;
  robotsTxtExists: boolean;
  sitemapXmlExists: boolean;
}

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

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links: Set<string> = new Set();
  const base = new URL(baseUrl);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname === base.hostname && resolved.protocol.startsWith("http")) {
        resolved.hash = "";
        links.add(resolved.href);
      }
    } catch {
      // skip invalid URLs
    }
  });

  return Array.from(links);
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

export async function crawlSite(inputUrl: string, maxPages = 16): Promise<CrawlResult> {
  const base = new URL(inputUrl);
  const result: CrawlResult = {
    pages: [],
    robotsTxt: null,
    sitemapXml: null,
    robotsTxtExists: false,
    sitemapXmlExists: false,
  };

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
  const queue: string[] = [inputUrl];

  if (result.sitemapXml) {
    const sitemapUrls = parseSitemapUrls(result.sitemapXml, base.hostname);
    for (const u of sitemapUrls.slice(0, maxPages)) {
      if (!visited.has(u) && !queue.includes(u)) {
        queue.push(u);
      }
    }
  }

  while (queue.length > 0 && result.pages.length < maxPages) {
    const url = queue.shift()!;
    const normalized = new URL(url);
    normalized.hash = "";
    const key = normalized.href;

    if (visited.has(key)) continue;
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

      if (result.pages.length < maxPages) {
        const links = extractInternalLinks(page.html, url);
        for (const link of links) {
          if (!visited.has(link) && !queue.includes(link)) {
            queue.push(link);
          }
        }
      }
    } catch (err) {
      logger.warn({ url, err }, "Failed to crawl page");
    }
  }

  return result;
}
