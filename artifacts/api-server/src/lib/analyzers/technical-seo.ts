import * as cheerio from "cheerio";
import type { CrawlResult, SitemapResolution } from "../crawler";
import { getTitleFromDom } from "../html-title";
import { LANG_PREFIX_RE } from "../language-path";
import { logger } from "../logger";
import { DEFAULT_TECHNICAL_PARAMS, type TechnicalScoreParams, type TechnicalBreakdown } from "./technical-params";

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
  type: "xml" | "xml_index" | "html" | "none";
  totalUrls: number;
  isSitemapIndex: boolean;
  oldestLastmod: string | null;
  newestLastmod: string | null;
  priorityDistribution: Record<string, number>;
  hasImageSitemap: boolean;
  hasVideoSitemap: boolean;
  crawledPageCoverage: number | null;
  nestedIndex: boolean;
  nestedExample: string[] | null;
  sitemapFilesRead: number | null;
  sitemapFilesComplete: boolean | null;
  htmlSitemapUrl: string | null;
  htmlSections: string[];
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
  breakdown: TechnicalBreakdown;
  responseTime: number;
  ttfb: number;
  httpStatusCodes: Record<string, number>;
  robotsTxt: boolean;
  sitemapXml: boolean;
  llmsTxt: boolean;
  robotsTxtStatus: "found" | "missing" | "error";
  sitemapStatus: "found" | "missing" | "error";
  llmsTxtStatus: "found" | "missing" | "error";
  sitemapType: "xml" | "xml_index" | "html" | "none";
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
    if (current && current.agents.length > 0) blocks.push(current);
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
    if (block.disallows.includes("/")) siteBlockedAgents.push(...block.agents);
  }

  const llmCrawlers: LlmCrawlerStatus[] = LLM_CRAWLER_NAMES.map((name) => {
    const nameLower = name.toLowerCase();
    const matchingBlock = blocks.find((b) => b.agents.some((a) => a.toLowerCase() === nameLower));
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

export function coverageKey(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return `${hostname}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`.toLowerCase();
  } catch {
    return url.replace(/\/$/, "").toLowerCase();
  }
}

function analyzeSitemapXml(
  content: string,
  type: "xml" | "xml_index",
  crawledPages: string[],
  resolution: SitemapResolution | null,
): SitemapXmlAnalysis {
  const isSitemapIndex = type === "xml_index";
  const locMatches = [...content.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)];
  const totalUrls = locMatches.length;

  const lastmodMatches = [...content.matchAll(/<lastmod>\s*(.*?)\s*<\/lastmod>/gi)];
  const dates = lastmodMatches.map((m) => m[1].trim()).filter((d) => /^\d{4}/.test(d)).sort();
  const oldestLastmod = dates.length > 0 ? dates[0] : null;
  const newestLastmod = dates.length > 0 ? dates[dates.length - 1] : null;

  const priorityMatches = [...content.matchAll(/<priority>\s*(.*?)\s*<\/priority>/gi)];
  const priorityDistribution: Record<string, number> = {};
  for (const m of priorityMatches) {
    const val = m[1].trim();
    priorityDistribution[val] = (priorityDistribution[val] || 0) + 1;
  }

  const hasImageSitemap = Boolean(resolution?.hasImage) || content.includes("image:") || content.includes("xmlns:image");
  const hasVideoSitemap = Boolean(resolution?.hasVideo) || content.includes("video:") || content.includes("xmlns:video");

  const sitemapUrls = locMatches.map((m) => m[1].trim());
  const sitemapUrlSet = new Set(sitemapUrls.map(coverageKey));
  const eligibleCrawled = crawledPages.filter((p) => p !== "uploaded-page");
  const matchedCrawled = eligibleCrawled.filter((p) => sitemapUrlSet.has(coverageKey(p)));
  const crawledPageCoverage =
    resolution && !resolution.complete && matchedCrawled.length !== eligibleCrawled.length
      ? null
      : eligibleCrawled.length > 0 ? Math.round((matchedCrawled.length / eligibleCrawled.length) * 100) : 0;

  let summary: string;
  if (totalUrls === 0 && (!resolution || resolution.complete)) {
    summary = "Die Sitemap ist leer oder enthält keine auswertbaren URLs.";
  } else if (isSitemapIndex) {
    const filesRead = resolution?.filesRead ?? 0;
    summary = `Sitemap-Index: ${totalUrls} Seiten-URLs aus ${filesRead} Teil-Sitemap${filesRead !== 1 ? "s" : ""}`
      + (resolution?.nested ? " — verschachtelter Aufbau (von Google nicht unterstützt)" : "")
      + (crawledPageCoverage !== null
        ? ` — ${crawledPageCoverage}% der gecrawlten Seiten sind enthalten.`
        : " — nicht alle Teil-Sitemaps konnten gelesen werden, die Abdeckung wird daher nicht bewertet.");
  } else {
    summary = `${totalUrls} URL${totalUrls !== 1 ? "s" : ""} indexiert, ${crawledPageCoverage}% der gecrawlten Seiten abgedeckt${dates.length === 0 ? " — keine Lastmod-Daten vorhanden" : ""}.`;
  }

  return {
    type,
    totalUrls,
    isSitemapIndex,
    oldestLastmod,
    newestLastmod,
    priorityDistribution,
    hasImageSitemap,
    hasVideoSitemap,
    crawledPageCoverage,
    nestedIndex: resolution?.nested ?? false,
    nestedExample: resolution?.nestedExample ?? null,
    sitemapFilesRead: resolution?.filesRead ?? null,
    sitemapFilesComplete: resolution?.complete ?? null,
    htmlSitemapUrl: null,
    htmlSections: [],
    summary,
  };
}

// ─── HTML sitemap analyser ────────────────────────────────────────────────────

function analyzeHtmlSitemap(
  html: string,
  url: string,
  crawledPages: string[],
): SitemapXmlAnalysis {
  const $ = cheerio.load(html);

  const totalUrls = $("a[href]").length;

  const htmlSections: string[] = [];
  $("h1, h2, h3, h4").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 120) htmlSections.push(text);
  });

  const linkHrefs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, url);
      linkHrefs.add(coverageKey(resolved.href));
    } catch {
      // skip
    }
  });

  const eligibleCrawled = crawledPages.filter((p) => p !== "uploaded-page");
  const matched = eligibleCrawled.filter((p) =>
    linkHrefs.has(coverageKey(p)),
  );
  const crawledPageCoverage =
    eligibleCrawled.length > 0 ? Math.round((matched.length / eligibleCrawled.length) * 100) : 0;

  return {
    type: "html",
    totalUrls,
    isSitemapIndex: false,
    oldestLastmod: null,
    newestLastmod: null,
    priorityDistribution: {},
    hasImageSitemap: false,
    hasVideoSitemap: false,
    crawledPageCoverage,
    nestedIndex: false,
    nestedExample: null,
    sitemapFilesRead: null,
    sitemapFilesComplete: null,
    htmlSitemapUrl: url,
    htmlSections: htmlSections.slice(0, 10),
    summary: `HTML-Sitemap mit ${totalUrls} Links in ${htmlSections.length} Sektion${htmlSections.length !== 1 ? "en" : ""} — ${crawledPageCoverage}% der gecrawlten Seiten enthalten.`,
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

export function analyzeTechnicalSeo(crawlResult: CrawlResult, inputUrl: string, overrides: Partial<TechnicalScoreParams> = {}): TechnicalSeoResult {
  const params = { ...DEFAULT_TECHNICAL_PARAMS, ...overrides };
  const pages = crawlResult.pages;
  const totalPages = pages.length;
  const uploaded = inputUrl === "uploaded-page" || pages.some(p => p.url === "uploaded-page");
  const host = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  const siteHost = uploaded ? null : host(inputUrl);
  const normalise = (text: string) => text.trim().replace(/\s+/g, " ");
  const titles: string[] = [];
  const descriptions: string[] = [];
  let indexablePages = 0;
  let sameSiteCanonicals = 0;
  let viewportPages = 0;
  let hasLanguageVersions = false;

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
    const canonical = $('link[rel~="canonical" i]');
    if (canonical.length > 0) canonicalCount++;
    if (canonical.toArray().some(el => {
      try {
        const href = $(el).attr("href")?.trim();
        return !!href && host(new URL(href, page.finalUrl || page.url).href) === siteHost;
      } catch { return false; }
    })) sameSiteCanonicals++;
    const noindex = $('meta[name="robots" i], meta[name="googlebot" i]').toArray()
      .some(el => /noindex/i.test($(el).attr("content") ?? ""));
    if (!noindex) indexablePages++;
    const hreflangs = $('link[rel~="alternate" i][hreflang]');
    if (hreflangs.length > 0) {
      hreflangPresent = true;
      hasLanguageVersions = true;
      hreflangPageCount++;
      hreflangs.each((_, el) => {
        const lang = $(el).attr("hreflang");
        if (lang) allLangs.add(lang);
      });
    }
    $("a[href]").each((_, el) => {
      try {
        const target = new URL($(el).attr("href")!, page.finalUrl || page.url);
        const lang = target.pathname.match(LANG_PREFIX_RE)?.[1].toLowerCase().split("-")[0];
        const currentLang = crawlResult.siteLanguage?.lang?.toLowerCase().split("-")[0];
        if (host(target.href) === siteHost && lang && currentLang && lang !== currentLang) hasLanguageVersions = true;
      } catch { /* Invalid or uploaded-page relative URL. */ }
    });
    const title = normalise(getTitleFromDom($) ?? "");
    titles.push(title);
    if (title) {
      titlePresent++;
      totalTitleLength += title.length;
      if (title.length < params.title_min) titleTooShort++;
      if (title.length > params.title_max) titleTooLong++;
    } else {
      titleMissing++;
    }
    const desc = normalise($('meta[name="description" i]').attr("content") ?? "");
    descriptions.push(desc);
    if (desc) {
      descPresent++;
      totalDescLength += desc.length;
      if (desc.length < params.desc_min) descTooShort++;
      if (desc.length > params.desc_max) descTooLong++;
    } else {
      descMissing++;
    }
    $("img").each((_, el) => {
      totalImages++;
      if ($(el).attr("alt")?.trim()) imagesWithAlt++;
    });
    if ($('meta[name="viewport" i]').length > 0) {
      hasMobileViewport = true;
      viewportPages++;
    }
  }

  const httpsRedirect = uploaded ? "unknown" : crawlResult.httpsRedirect ?? "unknown";
  if (uploaded) logger.warn({ reason: "uploaded-page" }, "https redirect check failed");
  const httpsEnforced = httpsRedirect === "enforced";
  const imageAltCoverage = totalImages > 0 ? (imagesWithAlt / totalImages) * 100 : 100;
  const hreflangConsistent = hreflangPresent
    ? hreflangPageCount === totalPages || hreflangPageCount >= totalPages * 0.8
    : true;

  const crawledPageUrls = pages.map((p) => p.url);
  const sitemapType = crawlResult.sitemapType ?? (crawlResult.sitemapXmlExists ? "xml" : "none");
  const robotsStatus = crawlResult.robotsTxtStatus ?? (crawlResult.robotsTxtExists ? "found" : "missing");
  const sitemapStatus = crawlResult.sitemapStatus ?? (sitemapType !== "none" ? "found" : "missing");
  const share = (count: number) => totalPages > 0 ? count / totalPages : 0;
  const textComponent = (values: string[], min: number, max: number) => {
    const counts = new Map<string, number>();
    for (const value of values) if (value) counts.set(value.toLowerCase(), (counts.get(value.toLowerCase()) ?? 0) + 1);
    let duplicate = 0, outOfRange = 0, missing = 0;
    const sum = values.reduce((sum, value) => {
      if (!value) { missing++; return sum; }
      let fraction = 1;
      if (value.length < min || value.length > max) { outOfRange++; fraction *= params.length_factor; }
      if (counts.get(value.toLowerCase())! >= 2) { duplicate++; fraction *= params.duplicate_factor; }
      return sum + fraction;
    }, 0);
    return { fraction: share(sum), detail: { missing, outOfRange, duplicate, pages: totalPages } };
  };
  const titleComponent = textComponent(titles, params.title_min, params.title_max);
  const descComponent = textComponent(descriptions, params.desc_min, params.desc_max);
  const reliability = crawlResult.reliability;
  const components: TechnicalBreakdown["components"] = [];
  const add = (key: TechnicalBreakdown["components"][number]["key"], fraction: number | null,
    detail: TechnicalBreakdown["components"][number]["detail"]) => {
    const weight = params[`weight_${key}`];
    components.push({ key, weight, fraction, points: fraction === null ? null : weight * fraction, detail });
  };
  add("https", httpsRedirect === "unknown" ? null : httpsEnforced ? 1 : 0, { status: httpsRedirect, uploaded });
  add("crawl", uploaded || !reliability?.attempted ? null : reliability.succeeded / reliability.attempted,
    { succeeded: reliability?.succeeded ?? 0, attempted: reliability?.attempted ?? 0, uploaded });
  add("robots", robotsStatus === "error" ? null : robotsStatus === "found" ? 1 : 0, { status: robotsStatus });
  add("sitemap", sitemapStatus === "error" ? null : sitemapStatus === "missing" ? 0
    : sitemapType === "html" ? params.html_sitemap_credit : sitemapType === "xml" || sitemapType === "xml_index" ? 1 : 0,
    { status: sitemapStatus, type: sitemapType });
  add("indexable", share(indexablePages), { noindex: totalPages - indexablePages, pages: totalPages });
  add("canonical", share(sameSiteCanonicals), { valid: sameSiteCanonicals, pages: totalPages });
  add("title", titleComponent.fraction, titleComponent.detail);
  add("description", descComponent.fraction, descComponent.detail);
  add("viewport", share(viewportPages), { present: viewportPages, pages: totalPages });
  add("alt", totalImages > 0 ? imagesWithAlt / totalImages : 1, { present: imagesWithAlt, images: totalImages });
  add("response", avgResponseTime < params.response_good_ms ? 1 : avgResponseTime < params.response_ok_ms ? params.response_ok_credit : 0,
    { avgMs: Math.round(avgResponseTime), goodMs: params.response_good_ms, okMs: params.response_ok_ms });
  add("hreflang", hasLanguageVersions ? hreflangPageCount >= totalPages * 0.8 ? 1 : share(hreflangPageCount) : null,
    { versions: hasLanguageVersions, present: hreflangPageCount, pages: totalPages });
  const evaluatedWeight = components.reduce((sum, c) => sum + (c.fraction === null ? 0 : c.weight), 0);
  if (evaluatedWeight === 0) logger.warn({ inputUrl }, "technical SEO has no evaluated weights");
  const score = evaluatedWeight === 0 ? 0 : Math.round(100 * components.reduce((sum, c) => sum + (c.points ?? 0), 0) / evaluatedWeight);
  const { title_min, title_max, desc_min, desc_max } = params;

  const robotsTxtAnalysis = crawlResult.robotsTxt ? analyzeRobotsTxt(crawlResult.robotsTxt) : null;

  let sitemapXmlAnalysis: SitemapXmlAnalysis | null = null;
  let sitemapXmlContent: string | null = null;

  if (crawlResult.sitemapXmlExists && crawlResult.sitemapXml) {
    sitemapXmlAnalysis = analyzeSitemapXml(
      crawlResult.sitemapXml,
      sitemapType === "xml_index" ? "xml_index" : "xml",
      crawledPageUrls,
      crawlResult.sitemapResolution ?? null,
    );
    sitemapXmlContent = crawlResult.sitemapXml.slice(0, 500);
  } else if (sitemapType === "html" && crawlResult.htmlSitemapHtml && crawlResult.htmlSitemapUrl) {
    sitemapXmlAnalysis = analyzeHtmlSitemap(
      crawlResult.htmlSitemapHtml,
      crawlResult.htmlSitemapUrl,
      crawledPageUrls,
    );
    sitemapXmlContent = crawlResult.htmlSitemapHtml.slice(0, 500);
  }

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
    breakdown: { components, evaluatedWeight, params: { title_min, title_max, desc_min, desc_max } },
    responseTime: Math.round(avgResponseTime),
    ttfb: Math.round(avgTtfb),
    httpStatusCodes,
    robotsTxt: crawlResult.robotsTxtExists,
    sitemapXml: crawlResult.sitemapXmlExists,
    llmsTxt: crawlResult.llmsTxtExists,
    robotsTxtStatus: robotsStatus,
    sitemapStatus,
    llmsTxtStatus: crawlResult.llmsTxtStatus ?? "missing",
    sitemapType,
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
    sitemapXmlContent,
    llmsTxtContent: crawlResult.llmsTxt ? crawlResult.llmsTxt.slice(0, 500) : null,
    robotsTxtAnalysis,
    sitemapXmlAnalysis,
    llmsTxtAnalysis,
  };
}
