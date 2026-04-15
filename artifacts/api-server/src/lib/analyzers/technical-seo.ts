import * as cheerio from "cheerio";
import type { CrawlResult } from "../crawler";

export interface TechnicalSeoResult {
  score: number;
  responseTime: number;
  ttfb: number;
  httpStatusCodes: Record<string, number>;
  robotsTxt: boolean;
  sitemapXml: boolean;
  canonicalTags: { present: boolean; count: number };
  hreflang: { present: boolean; languages: string[]; consistent: boolean };
  metaTitles: { present: number; avgLength: number; tooShort: number; tooLong: number; missing: number };
  metaDescriptions: { present: number; avgLength: number; tooShort: number; tooLong: number; missing: number };
  imageAltCoverage: number;
  mobileViewport: boolean;
  httpsEnforced: boolean;
}

export function analyzeTechnicalSeo(crawlResult: CrawlResult, inputUrl: string): TechnicalSeoResult {
  const pages = crawlResult.pages;
  const totalPages = pages.length;

  const avgResponseTime = totalPages > 0
    ? pages.reduce((sum, p) => sum + p.responseTime, 0) / totalPages
    : 0;
  const avgTtfb = totalPages > 0
    ? pages.reduce((sum, p) => sum + p.ttfb, 0) / totalPages
    : 0;

  const httpStatusCodes: Record<string, number> = {};
  for (const page of pages) {
    const code = String(page.statusCode);
    httpStatusCodes[code] = (httpStatusCodes[code] || 0) + 1;
  }

  let canonicalCount = 0;
  let hreflangPresent = false;
  const allLangs = new Set<string>();
  let hreflangPageCount = 0;

  let titlePresent = 0;
  let titleMissing = 0;
  let titleTooShort = 0;
  let titleTooLong = 0;
  let totalTitleLength = 0;

  let descPresent = 0;
  let descMissing = 0;
  let descTooShort = 0;
  let descTooLong = 0;
  let totalDescLength = 0;

  let totalImages = 0;
  let imagesWithAlt = 0;
  let hasMobileViewport = false;

  for (const page of pages) {
    const $ = cheerio.load(page.html);

    const canonical = $('link[rel="canonical"]');
    if (canonical.length > 0) canonicalCount++;

    const hreflangs = $('link[rel="alternate"][hreflang]');
    if (hreflangs.length > 0) {
      hreflangPresent = true;
      hreflangPageCount++;
      hreflangs.each((_, el) => {
        const lang = $(el).attr("hreflang");
        if (lang) allLangs.add(lang);
      });
    }

    const title = $("title").text().trim();
    if (title) {
      titlePresent++;
      totalTitleLength += title.length;
      if (title.length < 30) titleTooShort++;
      if (title.length > 60) titleTooLong++;
    } else {
      titleMissing++;
    }

    const desc = $('meta[name="description"]').attr("content")?.trim() || "";
    if (desc) {
      descPresent++;
      totalDescLength += desc.length;
      if (desc.length < 50) descTooShort++;
      if (desc.length > 160) descTooLong++;
    } else {
      descMissing++;
    }

    $("img").each((_, el) => {
      totalImages++;
      if ($(el).attr("alt")?.trim()) imagesWithAlt++;
    });

    if ($('meta[name="viewport"]').length > 0) {
      hasMobileViewport = true;
    }
  }

  const httpsEnforced = inputUrl.startsWith("https://");
  const imageAltCoverage = totalImages > 0 ? (imagesWithAlt / totalImages) * 100 : 100;
  const hreflangConsistent = hreflangPresent
    ? hreflangPageCount === totalPages || hreflangPageCount >= totalPages * 0.8
    : true;

  let score = 0;
  if (crawlResult.robotsTxtExists) score += 8;
  if (crawlResult.sitemapXmlExists) score += 8;
  if (canonicalCount > 0) score += 10;
  if (httpsEnforced) score += 10;
  if (hasMobileViewport) score += 8;

  const titleRatio = totalPages > 0 ? titlePresent / totalPages : 0;
  score += Math.round(titleRatio * 15);

  const descRatio = totalPages > 0 ? descPresent / totalPages : 0;
  score += Math.round(descRatio * 12);

  score += Math.round((imageAltCoverage / 100) * 10);

  const goodStatus = (httpStatusCodes["200"] || 0) / Math.max(totalPages, 1);
  score += Math.round(goodStatus * 10);

  if (avgResponseTime < 1000) score += 5;
  else if (avgResponseTime < 2000) score += 3;

  if (hreflangPresent && hreflangConsistent) score += 4;

  score = Math.min(100, Math.max(0, score));

  return {
    score,
    responseTime: Math.round(avgResponseTime),
    ttfb: Math.round(avgTtfb),
    httpStatusCodes,
    robotsTxt: crawlResult.robotsTxtExists,
    sitemapXml: crawlResult.sitemapXmlExists,
    canonicalTags: { present: canonicalCount > 0, count: canonicalCount },
    hreflang: { present: hreflangPresent, languages: Array.from(allLangs), consistent: hreflangConsistent },
    metaTitles: {
      present: titlePresent,
      avgLength: titlePresent > 0 ? Math.round(totalTitleLength / titlePresent) : 0,
      tooShort: titleTooShort,
      tooLong: titleTooLong,
      missing: titleMissing,
    },
    metaDescriptions: {
      present: descPresent,
      avgLength: descPresent > 0 ? Math.round(totalDescLength / descPresent) : 0,
      tooShort: descTooShort,
      tooLong: descTooLong,
      missing: descMissing,
    },
    imageAltCoverage: Math.round(imageAltCoverage),
    mobileViewport: hasMobileViewport,
    httpsEnforced,
  };
}
