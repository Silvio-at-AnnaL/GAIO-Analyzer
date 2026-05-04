import * as cheerio from "cheerio";
import type { CrawlResult } from "../crawler";

// ─── LLM crawler list ─────────────────────────────────────────────────────────

const LLM_CRAWLER_NAMES = [
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "GoogleBot",
  "Google-Extended",
  "PerplexityBot",
  "Amazonbot",
  "cohere-ai",
  "meta-externalagent",
] as const;

// ─── Analysis interfaces ──────────────────────────────────────────────────────

export interface LlmCrawlerStatus {
  name: string;
  status: "allowed" | "disallowed" | "not_mentioned";
}

export interface RobotsTxtAnalysis {
  userAgents: string[];
  llmCrawlers: LlmCrawlerStatus[];
  siteBlockedAgents: string[];
  crawlDelays: Array<{ agent: string; delay: number }>;
  sitemapUrls: string[];
  summary: string;
}

export interface SitemapXmlAnalysis {
  totalUrls: number;
  isSitemapIndex: boolean;
  oldestLastmod: string | null;
  newestLastmod: string | null;
  priorityDistribution: Record<string, number>;
  hasImageSitemap: boolean;
  hasVideoSitemap: boolean;
  crawledPageCoverage: number;
  summary: string;
}

export interface LlmsTxtSection {
  name: string;
  links: Array<{ title: string; url: string; description: string }>;
}

export interface LlmsTxtAnalysis {
  present: boolean;
  title: string | null;
  description: string | null;
  sections: LlmsTxtSection[];
  linkedPageCount: number;
  hasDescription: boolean;
  summary: string;
}

export interface TechnicalSeoResult {
  score: number;
  responseTime: number;
  ttfb: number;
  httpStatusCodes: Record<string, number>;
  robotsTxt: boolean;
  sitemapXml: boolean;
  llmsTxt: boolean;
  canonicalTags: { present: boolean; count: number };
  hreflang: { present: boolean; languages: string[]; consistent: boolean };
  metaTitles: { present: number; avgLength: number; tooShort: number; tooLong: number; missing: number };
  metaDescriptions: { present: number; avgLength: number; tooShort: number; tooLong: number; missing: number };
  imageAltCoverage: number;
  mobileViewport: boolean;
  httpsEnforced: boolean;
  robotsTxtContent: string | null;
  sitemapXmlContent: string | null;
  llmsTxtContent: string | null;
  robotsTxtAnalysis: RobotsTxtAnalysis | null;
  sitemapXmlAnalysis: SitemapXmlAnalysis | null;
  llmsTxtAnalysis: LlmsTxtAnalysis;
}

// ─── robots.txt parser ────────────────────────────────────────────────────────

interface RobotsBlock {
  agents: string[];
  disallows: string[];
  allows: string[];
  crawlDelay: number | null;
}

function parseRobotsTxtBlocks(content: string): { blocks: RobotsBlock[]; sitemapUrls: string[] } {
  const blocks: RobotsBlock[] = [];
  const sitemapUrls: string[] = [];
  let current: RobotsBlock | null = null;

  const flushCurrent = () => {
    if (current && current.agents.length > 0) {
      blocks.push(current);
    }
    current = null;
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      if (line === "") flushCurrent();
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (key === "user-agent") {
      if (current && (current.disallows.length > 0 || current.allows.length > 0 || current.crawlDelay !== null)) {
        flushCurrent();
      }
      if (!current) current = { agents: [], disallows: [], allows: [], crawlDelay: null };
      current.agents.push(val);
    } else if (key === "disallow") {
      if (!current) current = { agents: ["*"], disallows: [], allows: [], crawlDelay: null };
      current.disallows.push(val);
    } else if (key === "allow") {
      if (!current) current = { agents: ["*"], disallows: [], allows: [], crawlDelay: null };
      current.allows.push(val);
    } else if (key === "crawl-delay") {
      const delay = parseFloat(val);
      if (!isNaN(delay) && current) current.crawlDelay = delay;
    } else if (key === "sitemap") {
      sitemapUrls.push(val);
    }
  }

  flushCurrent();
  return { blocks, sitemapUrls };
}

function analyzeRobotsTxt(content: string): RobotsTxtAnalysis {
  const { blocks, sitemapUrls } = parseRobotsTxtBlocks(content);

  const allUserAgents = [...new Set(blocks.flatMap((b) => b.agents))];

  const siteBlockedAgents: string[] = [];
  for (const block of blocks) {
    if (block.disallows.includes("/")) {
      siteBlockedAgents.push(...block.agents);
    }
  }

  const llmCrawlers: LlmCrawlerStatus[] = LLM_CRAWLER_NAMES.map((name) => {
    const nameLower = name.toLowerCase();
    const matchingBlock = blocks.find((b) =>
      b.agents.some((a) => a.toLowerCase() === nameLower),
    );

    if (!matchingBlock) return { name, status: "not_mentioned" };
    if (matchingBlock.disallows.includes("/")) return { name, status: "disallowed" };
    return { name, status: "allowed" };
  });

  const crawlDelays = blocks
    .filter((b) => b.crawlDelay !== null)
    .flatMap((b) => b.agents.map((agent) => ({ agent, delay: b.crawlDelay! })));

  const wildcardBlocked = siteBlockedAgents.includes("*");
  const blockedLlms = llmCrawlers.filter((c) => c.status === "disallowed").map((c) => c.name);
  const notMentionedCount = llmCrawlers.filter((c) => c.status === "not_mentioned").length;

  let summary: string;
  if (wildcardBlocked) {
    summary = "Die gesamte Website ist für alle Crawler gesperrt — kritisches Problem für LLM-Sichtbarkeit.";
  } else if (blockedLlms.length > 0) {
    summary = `${blockedLlms.join(", ")} ${blockedLlms.length === 1 ? "ist" : "sind"} explizit gesperrt — dies verhindert LLM-Indexierung durch diese Dienste.`;
  } else if (notMentionedCount === LLM_CRAWLER_NAMES.length) {
    summary = "Keine LLM-Crawler explizit adressiert — Konfiguration für KI-Sichtbarkeit optimierungsbedürftig.";
  } else {
    const allowedCount = llmCrawlers.filter((c) => c.status === "allowed").length;
    summary = `robots.txt adressiert ${allowedCount} von ${LLM_CRAWLER_NAMES.length} LLM-Crawlern explizit.`;
  }

  return { userAgents: allUserAgents, llmCrawlers, siteBlockedAgents, crawlDelays, sitemapUrls, summary };
}

// ─── sitemap.xml analyser ─────────────────────────────────────────────────────

function analyzeSitemapXml(content: string, crawledPages: string[]): SitemapXmlAnalysis {
  const isSitemapIndex = content.includes("<sitemapindex");

  const locMatches = [...content.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)];
  const totalUrls = locMatches.length;

  const lastmodMatches = [...content.matchAll(/<lastmod>\s*(.*?)\s*<\/lastmod>/gi)];
  const dates = lastmodMatches
    .map((m) => m[1].trim())
    .filter((d) => /^\d{4}/.test(d))
    .sort();
  const oldestLastmod = dates.length > 0 ? dates[0] : null;
  const newestLastmod = dates.length > 0 ? dates[dates.length - 1] : null;

  const priorityMatches = [...content.matchAll(/<priority>\s*(.*?)\s*<\/priority>/gi)];
  const priorityDistribution: Record<string, number> = {};
  for (const m of priorityMatches) {
    const val = m[1].trim();
    priorityDistribution[val] = (priorityDistribution[val] || 0) + 1;
  }

  const hasImageSitemap = content.includes("image:") || content.includes("xmlns:image");
  const hasVideoSitemap = content.includes("video:") || content.includes("xmlns:video");

  const sitemapUrls = locMatches.map((m) => m[1].trim());
  const normalise = (u: string) => u.replace(/\/$/, "").toLowerCase();
  const sitemapUrlSet = new Set(sitemapUrls.map(normalise));
  const matchedCrawled = crawledPages.filter(
    (p) => p !== "uploaded-page" && sitemapUrlSet.has(normalise(p)),
  );
  const eligibleCrawled = crawledPages.filter((p) => p !== "uploaded-page");
  const crawledPageCoverage =
    eligibleCrawled.length > 0 ? Math.round((matchedCrawled.length / eligibleCrawled.length) * 100) : 0;

  let summary: string;
  if (totalUrls === 0) {
    summary = "Die Sitemap ist leer oder enthält keine auswertbaren URLs.";
  } else if (isSitemapIndex) {
    summary = `Sitemap-Index mit ${totalUrls} Einträgen — ${crawledPageCoverage}% der gecrawlten Seiten sind enthalten.`;
  } else {
    summary = `${totalUrls} URL${totalUrls !== 1 ? "s" : ""} indexiert, ${crawledPageCoverage}% der gecrawlten Seiten abgedeckt${dates.length === 0 ? " — keine Lastmod-Daten vorhanden" : ""}.`;
  }

  return {
    totalUrls,
    isSitemapIndex,
    oldestLastmod,
    newestLastmod,
    priorityDistribution,
    hasImageSitemap,
    hasVideoSitemap,
    crawledPageCoverage,
    summary,
  };
}

// ─── llms.txt analyser ────────────────────────────────────────────────────────

function analyzeLlmsTxt(content: string): LlmsTxtAnalysis {
  const lines = content.split("\n");
  let title: string | null = null;
  let description: string | null = null;
  const sections: LlmsTxtSection[] = [];
  let currentSection: LlmsTxtSection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("# ") && !title) {
      title = line.slice(2).trim();
    } else if (line.startsWith("> ")) {
      const chunk = line.slice(2).trim();
      description = description ? `${description} ${chunk}` : chunk;
    } else if (line.startsWith("## ")) {
      currentSection = { name: line.slice(3).trim(), links: [] };
      sections.push(currentSection);
    } else if (line.startsWith("- ") && currentSection) {
      const linkMatch = line.match(/^- \[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?/);
      if (linkMatch) {
        currentSection.links.push({
          title: linkMatch[1],
          url: linkMatch[2],
          description: linkMatch[3] ?? "",
        });
      }
    }
  }

  const linkedPageCount = sections.reduce((sum, s) => sum + s.links.length, 0);
  const hasDescription = !!description && description.length >= 20;

  let summary: string;
  if (!title && sections.length === 0 && linkedPageCount === 0) {
    summary = "llms.txt enthält keine strukturierten Abschnitte — Qualität für LLM-Crawler eingeschränkt.";
  } else if (linkedPageCount < 3) {
    summary = "llms.txt vorhanden, aber nur wenige verlinkte Seiten — Ausbau empfohlen für bessere LLM-Sichtbarkeit.";
  } else {
    summary = `llms.txt gut strukturiert mit ${sections.length} Abschnitt${sections.length !== 1 ? "en" : ""} und ${linkedPageCount} verlinkten Seiten.`;
  }

  return { present: true, title, description, sections, linkedPageCount, hasDescription, summary };
}

// ─── Main analyser ────────────────────────────────────────────────────────────

export function analyzeTechnicalSeo(crawlResult: CrawlResult, inputUrl: string): TechnicalSeoResult {
  const pages = crawlResult.pages;
  const totalPages = pages.length;

  const avgResponseTime =
    totalPages > 0 ? pages.reduce((sum, p) => sum + p.responseTime, 0) / totalPages : 0;
  const avgTtfb =
    totalPages > 0 ? pages.reduce((sum, p) => sum + p.ttfb, 0) / totalPages : 0;

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

    if ($('link[rel="canonical"]').length > 0) canonicalCount++;

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

    if ($('meta[name="viewport"]').length > 0) hasMobileViewport = true;
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

  const crawledPageUrls = pages.map((p) => p.url);

  const robotsTxtAnalysis = crawlResult.robotsTxt
    ? analyzeRobotsTxt(crawlResult.robotsTxt)
    : null;

  const sitemapXmlAnalysis = crawlResult.sitemapXml
    ? analyzeSitemapXml(crawlResult.sitemapXml, crawledPageUrls)
    : null;

  const llmsTxtAnalysis: LlmsTxtAnalysis = crawlResult.llmsTxt
    ? analyzeLlmsTxt(crawlResult.llmsTxt)
    : {
        present: false,
        title: null,
        description: null,
        sections: [],
        linkedPageCount: 0,
        hasDescription: false,
        summary: "llms.txt nicht gefunden — eine verpasste Chance zur gezielten LLM-Optimierung.",
      };

  return {
    score,
    responseTime: Math.round(avgResponseTime),
    ttfb: Math.round(avgTtfb),
    httpStatusCodes,
    robotsTxt: crawlResult.robotsTxtExists,
    sitemapXml: crawlResult.sitemapXmlExists,
    llmsTxt: crawlResult.llmsTxtExists,
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
    robotsTxtContent: crawlResult.robotsTxt ? crawlResult.robotsTxt.slice(0, 500) : null,
    sitemapXmlContent: crawlResult.sitemapXml ? crawlResult.sitemapXml.slice(0, 500) : null,
    llmsTxtContent: crawlResult.llmsTxt ? crawlResult.llmsTxt.slice(0, 500) : null,
    robotsTxtAnalysis,
    sitemapXmlAnalysis,
    llmsTxtAnalysis,
  };
}
