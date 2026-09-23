import { Router, type IRouter } from "express";
import * as cheerio from "cheerio";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getPrompt, fillTemplate } from "../lib/prompt-manager.js";
import { logger } from "../lib/logger";
import {
  classifyFetchError,
  classifyHttpStatus,
  detectBlockedContent,
  type CrawlFailReason,
} from "../lib/fetch-diagnostics";

const router: IRouter = Router();

// ── Priority scoring for about/product pages ─────────────────────────────────

const ABOUT_PATTERN =
  /ueber-uns|ueber_uns|about|about-us|about_us|unternehmen|company|wir-ueber-uns|philosophy|philosophie|mission|vision|team/i;

const PRODUCT_PATTERN =
  /produkt|produkte|product|products|loesungen|solutions|leistungen|services|portfolio|sortiment|angebot/i;

const EXCLUDED_PATTERN =
  /login|logout|cart|warenkorb|checkout|impressum|datenschutz|privacy|cookie|agb|terms|sitemap|feed|rss|wp-admin|wp-json/i;

const EXCLUDED_EXT = /\.(pdf|jpg|jpeg|png|gif|svg|mp4|zip|css|js)(\?|$)/i;

function scorePrefillUrl(urlStr: string): number {
  if (EXCLUDED_PATTERN.test(urlStr)) return 0;
  if (EXCLUDED_EXT.test(urlStr)) return 0;
  if (ABOUT_PATTERN.test(urlStr)) return 100;
  if (PRODUCT_PATTERN.test(urlStr)) return 80;
  return 10;
}

function competitorKey(input: string): string {
  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function marketRegionFor(url: string, homepageLang: string | null): string {
  let tld: string;
  try {
    tld = new URL(url).hostname.toLowerCase().split(".").at(-1) ?? "";
  } catch {
    return "unbekannt";
  }
  const lang = homepageLang?.split(/[-_]/)[0].toLowerCase();
  if (tld === "at") return "Österreich / DACH-Raum, deutschsprachig";
  if (tld === "ch") return "Schweiz / DACH-Raum, deutschsprachig";
  if (tld === "de") return "Deutschland / DACH-Raum, deutschsprachig";
  if (lang === "de") return "deutschsprachiger Markt";
  if (lang === "en" && /^[a-z]{2}$/.test(tld)) return `.${tld}-Markt, englischsprachig`;
  return "unbekannt";
}

function competitorReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 200).trim() : "";
}

// ── Text extraction ───────────────────────────────────────────────────────────

function extractText(html: string, maxChars = 1500): string {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside, noscript, [aria-hidden='true']").remove();
  const text = ($("main").length ? $("main") : $("body"))
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, maxChars);
}

// ── Internal link extraction ──────────────────────────────────────────────────

function extractInternalLinks(html: string, baseUrl: string, baseDomain: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== baseDomain) return;
      if (!resolved.protocol.startsWith("http")) return;
      resolved.hash = "";
      if (resolved.pathname !== "/" && resolved.pathname.endsWith("/")) {
        resolved.pathname = resolved.pathname.slice(0, -1);
      }
      const normalised = resolved.href;
      if (seen.has(normalised)) return;
      seen.add(normalised);
      if (scorePrefillUrl(normalised) === 0) return;
      results.push(normalised);
    } catch {
      // skip
    }
  });

  return results;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

const CRAWLER_UA = "GAIOAnalyzer/1.0 (Website Audit Tool)";

async function fetchHtml(
  url: string,
  timeoutMs = 8000,
  onError?: (reason: CrawlFailReason) => void,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": CRAWLER_UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      redirect: "follow",
    });
    const html = await resp.text();
    const blocked = detectBlockedContent(html);
    if (blocked) {
      onError?.(blocked);
      return null;
    }
    if (!resp.ok) {
      const reason = classifyHttpStatus(resp.status);
      onError?.(reason);
      return null;
    }
    return html;
  } catch (err) {
    const reason = classifyFetchError(err);
    logger.warn({ url, reason }, "Prefill: fetch failed");
    onError?.(reason);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyAtMost(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";

  while (bytesRead < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - bytesRead;
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    bytesRead += chunk.byteLength;
    body += decoder.decode(chunk, { stream: bytesRead < maxBytes });
    if (chunk.byteLength < value.byteLength) {
      await reader.cancel();
      break;
    }
  }

  body += decoder.decode();
  return body;
}

async function verifyUrl(url: string, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  const cap = Math.min(timeoutMs, 6000);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), cap);
    try {
      const resp = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": CRAWLER_UA },
      });
      if (resp.status >= 400) return false;
      const body = await readBodyAtMost(resp, 300 * 1024);
      const blocked = detectBlockedContent(body);
      if (blocked !== null) {
        logger.warn({ url, reason: blocked }, "Prefill: suggested competitor rejected");
        return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

// ── Attempt 2: Ask Claude to correct a broken URL ────────────────────────────

async function claudeCorrectUrl(name: string, originalUrl: string): Promise<string | null> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `Find the correct official website URL for this company: '${name}'

The URL I have is '${originalUrl}' but it appears to be unreachable — it may contain a typo, wrong umlaut spelling, missing hyphen, or wrong TLD.

Return ONLY a JSON object, no other text:
{ "url": "https://..." }

Rules:
- Return the main homepage URL only
- Must start with https://
- If you are not confident about the correct URL, return the original URL unchanged rather than guessing`,
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const match = text.match(/\{[^}]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const u = typeof parsed.url === "string" ? parsed.url.trim() : null;
    return u && u.startsWith("https://") ? u : null;
  } catch {
    return null;
  }
}

// ── Attempt 4: Ask Claude for a replacement competitor ────────────────────────

async function claudeFindReplacement(
  failedName: string,
  contentSummary: string | null,
  marketRegion: string,
  confirmedNames: Set<string>,
  usedHosts: Set<string>,
  reserveHost: (url: string, stage: string) => boolean,
): Promise<{ name: string; url: string; reason: string } | null> {
  try {
    const confirmedList = Array.from(confirmedNames).join(", ") || "none yet";
    const usedHostList = Array.from(usedHosts).join(", ");
    const context = contentSummary ?? "No content summary available";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 220,
      messages: [
        {
          role: "user",
          content: `The following competitor could not be verified online: '${failedName}'

Based on this company's product context:
${context}
Market region: ${marketRegion}

Suggest ONE different direct competitor that:
- Sells similar products to the same industries
- Actually serves this market with its own local presence or shipping
- Is not a marketplace, platform, directory, association, municipality, public authority, parent company, reseller of this company's products, or manufacturer whose products this company distributes
- Has a domain that belongs to the named company, not a place, person or unrelated organisation with the same name
- Is NOT in this list of already confirmed competitors: ${confirmedList}
- Has a domain NOT in this list of already suggested, corrected or replaced domains: ${usedHostList}
- Has a website you are highly confident exists and is reachable

Return ONLY JSON, no other text:
{ "name": "...", "url": "https://...", "reason": "<ein Satz auf Deutsch: warum ist das ein direkter Wettbewerber?>" }

The reason is mandatory, plain German prose, at most 140 characters.

If you cannot suggest a reliable replacement, return:
{ "name": null, "url": null, "reason": null }`,
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const match = text.match(/\{[^}]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.name || !parsed.url) return null;
    if (typeof parsed.name !== "string" || typeof parsed.url !== "string") return null;
    if (!parsed.url.startsWith("https://")) return null;
    const url = parsed.url.trim();
    if (!reserveHost(url, "replacement")) return null;
    return { name: parsed.name.trim(), url, reason: competitorReason(parsed.reason) };
  } catch {
    return null;
  }
}

// ── Full 4-attempt validation pipeline for one competitor ─────────────────────

async function validateCompetitor(
  competitor: { name: string; url: string; reason: string },
  contentSummary: string | null,
  marketRegion: string,
  confirmedNames: Set<string>,
  usedHosts: Set<string>,
  reserveHost: (url: string, stage: string) => boolean,
): Promise<{ name: string; url: string; reason: string; verified: boolean }> {
  const deadline = Date.now() + 15000;

  // ATTEMPT 1 — verify AI-suggested URL
  const rem1 = deadline - Date.now();
  if (rem1 > 0) {
    const valid = await verifyUrl(competitor.url, Math.min(rem1, 6000));
    logger.info(
      { url: competitor.url, status: valid ? "valid" : "unreachable" },
      "Prefill validate: Checking",
    );
    if (valid) {
      confirmedNames.add(competitor.name.toLowerCase());
      return { ...competitor, verified: true };
    }
  }

  // ATTEMPT 2 — ask Claude to correct the URL
  const rem2 = deadline - Date.now();
  let correctedUrl: string | null = null;
  if (rem2 > 1000) {
    correctedUrl = await claudeCorrectUrl(competitor.name, competitor.url);
  }

  // ATTEMPT 3 — verify the corrected URL
  if (correctedUrl && correctedUrl !== competitor.url &&
      (competitorKey(correctedUrl) === competitorKey(competitor.url) || reserveHost(correctedUrl, "correction"))) {
    const rem3 = deadline - Date.now();
    if (rem3 > 0) {
      const valid3 = await verifyUrl(correctedUrl, Math.min(rem3, 6000));
      logger.info(
        { original: competitor.url, corrected: correctedUrl, valid: valid3 },
        "Prefill validate: Corrected",
      );
      if (valid3) {
        confirmedNames.add(competitor.name.toLowerCase());
        return { ...competitor, url: correctedUrl, verified: true };
      }
    }
  }

  // ATTEMPT 4 — ask Claude for a replacement competitor
  const rem4 = deadline - Date.now();
  if (rem4 > 1000) {
    const replacement = await claudeFindReplacement(competitor.name, contentSummary, marketRegion, confirmedNames, usedHosts, reserveHost);
    if (replacement) {
      const rem5 = deadline - Date.now();
      if (rem5 > 0) {
        const valid5 = await verifyUrl(replacement.url, Math.min(rem5, 4000));
        logger.info(
          { failed: competitor.name, replacement: replacement.name, valid: valid5 },
          "Prefill validate: Replaced",
        );
        if (valid5) {
          confirmedNames.add(replacement.name.toLowerCase());
          return { ...replacement, verified: true };
        }
      }
    }
  }

  // All attempts exhausted — return original with verified: false
  logger.info({ url: competitor.url }, "Prefill validate: Could not verify — keeping original");
  return { ...competitor, verified: false };
}

// ── Mini-crawl for prefill (max 8 pages) ─────────────────────────────────────

interface PageContent {
  url: string;
  text: string;
}

async function miniCrawl(
  inputUrl: string,
  maxPages = 8,
): Promise<{ pages: PageContent[]; failReason: CrawlFailReason | null; homepageLang: string | null }> {
  const base = new URL(inputUrl);
  const baseDomain = base.hostname;
  const results: PageContent[] = [];

  let failReason: CrawlFailReason | null = null;
  const homepageHtml = await fetchHtml(inputUrl, 10000, (r) => { failReason = r; });
  if (!homepageHtml) return { pages: results, failReason: failReason ?? "unknown", homepageLang: null };
  const homepageLang = cheerio.load(homepageHtml)("html").attr("lang") ?? null;

  const homepageText = extractText(homepageHtml);
  if (homepageText) results.push({ url: inputUrl, text: homepageText });

  const links = extractInternalLinks(homepageHtml, inputUrl, baseDomain)
    .filter((u) => u !== inputUrl)
    .map((u) => ({ url: u, score: scorePrefillUrl(u) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPages - 1);

  const fetched = await Promise.allSettled(
    links.map(async ({ url }) => {
      const html = await fetchHtml(url);
      if (!html) return null;
      const text = extractText(html);
      if (!text) return null;
      return { url, text };
    }),
  );

  for (const outcome of fetched) {
    if (outcome.status === "fulfilled" && outcome.value) {
      results.push(outcome.value);
      if (results.length >= maxPages) break;
    }
  }

  return { pages: results, failReason: null, homepageLang };
}

// ── Build content summary ─────────────────────────────────────────────────────

function buildContentSummary(pages: PageContent[], maxTotal = 8000): string {
  if (pages.length === 0) return "";
  const sections = pages.map((p) => `=== ${p.url} ===\n${p.text}`);
  let summary = sections.join("\n\n");
  if (summary.length > maxTotal) {
    summary = summary.slice(0, maxTotal) + "\n[content truncated]";
  }
  return summary;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function normaliseUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.includes(".")) return `https://${s}`;
  return null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^[-•*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function buildPrompt(
  company_name: string,
  url: string,
  crawledContent: string,
  crawlFailed: boolean,
  marketRegion: string,
): Promise<string> {
  if (crawlFailed) {
    return `You are a B2B market research assistant. Analyze the following company and provide structured information.

Company: ${company_name}
Website: ${url}
Market region: ${marketRegion}

NOTE: The website could not be crawled. Base your analysis on the company name, URL, and any general knowledge you have.

TASK 1 — TARGET AUDIENCES
Identify the primary B2B buyer personas. Include relevant industries, job titles/roles, and key buying criteria. Write 3-5 concise sentences in German.

TASK 2 — COMPETITORS
Identify 5-8 direct competitors — companies that sell similar products to the same target industries. Only list companies you are confident exist with real websites.
They must serve the stated market. Exclude marketplaces, directories, associations, public authorities, parent companies, resellers of this company's products and manufacturers whose products this company distributes. Verify that each domain belongs to the company named.

Return ONLY valid JSON, no other text:
{
  "content_summary": null,
  "personas": "<German prose, 3-5 sentences>",
  "competitors": [
    { "name": "<company>", "url": "https://...", "reason": "<ein Satz auf Deutsch: warum ist das ein direkter Wettbewerber?>" }
  ]
}

All text must be in German. Each reason is mandatory, plain prose, one sentence of at most 140 characters. The personas field must be plain prose — no bullet points, no markdown.`;
  }

  return fillTemplate(await getPrompt("prefill-analysis"), {
    CRAWLED_CONTENT: crawledContent,
    COMPANY_NAME: company_name,
    WEBSITE_URL: url,
    MARKET_REGION: marketRegion,
  });
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/prefill", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const company_name = typeof body.company_name === "string" ? body.company_name.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!company_name || !url) {
    res.status(400).json({ error: "company_name and url are required" });
    return;
  }

  // STEP 1 — Mini-crawl
  logger.info({ url }, "Prefill: starting mini-crawl");
  let pages: PageContent[] = [];
  let crawlFailed = false;
  let crawlFailReason: CrawlFailReason | null = null;
  let homepageLang: string | null = null;

  try {
    const outcome = await miniCrawl(url, 8);
    pages = outcome.pages;
    homepageLang = outcome.homepageLang;
    crawlFailed = pages.length === 0;
    crawlFailReason = crawlFailed ? (outcome.failReason ?? "unknown") : null;
    logger.info({ url, pageCount: pages.length, crawlFailed, crawlFailReason }, "Prefill: crawl complete");
  } catch (err) {
    crawlFailReason = classifyFetchError(err);
    logger.warn({ url, err, crawlFailReason }, "Prefill: crawl error — proceeding without content");
    crawlFailed = true;
  }

  // STEP 2 — Build content summary
  const crawledContent = buildContentSummary(pages, 8000);
  const marketRegion = marketRegionFor(url, homepageLang);
  logger.info({ url, marketRegion }, "Prefill: market region derived");

  // STEP 3 — Call Claude for initial analysis
  const prompt = await buildPrompt(company_name, url, crawledContent, crawlFailed, marketRegion);

  let personas = "";
  let rawCompetitors: { name: string; url: string; reason: string }[] = [];
  let content_summary: string | null = null;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error({ rawText }, "Prefill: no JSON found in AI response");
      res.status(500).json({ error: "AI returned an unexpected format" });
      return;
    }

    let parsed: { personas?: unknown; competitors?: unknown; content_summary?: unknown };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      logger.error({ jsonMatch: jsonMatch[0] }, "Prefill: failed to parse JSON");
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    personas = typeof parsed.personas === "string" ? stripMarkdown(parsed.personas) : "";

    const raw = Array.isArray(parsed.competitors) ? parsed.competitors : [];
    rawCompetitors = raw
      .filter(
        (c): c is { name: string; url: string; reason?: unknown } =>
          c && typeof c === "object" && typeof c.name === "string" && typeof c.url === "string",
      )
      .map((c) => ({ name: c.name.trim(), url: normaliseUrl(c.url) ?? c.url, reason: competitorReason(c.reason) }))
      .filter((c) => c.url.startsWith("http"));

    content_summary =
      typeof parsed.content_summary === "string" && parsed.content_summary.trim()
        ? stripMarkdown(parsed.content_summary)
        : null;
  } catch (err) {
    logger.error({ err }, "Prefill: AI call failed");
    res.status(500).json({ error: "AI service error" });
    return;
  }

  // STEP 4 — Validate & correct competitor URLs in parallel
  logger.info({ count: rawCompetitors.length }, "Prefill: starting URL validation");
  const confirmedNames = new Set<string>();
  const usedHosts = new Set<string>([competitorKey(url)]);
  let duplicateHostDrops = 0;
  const reserveHost = (candidateUrl: string, stage: string): boolean => {
    const host = competitorKey(candidateUrl);
    if (!host) {
      logger.info({ candidateUrl, stage }, "Prefill: invalid competitor host dropped");
      return false;
    }
    if (usedHosts.has(host)) {
      duplicateHostDrops++;
      logger.info({ host, stage, duplicateHostDrops }, "Prefill: duplicate competitor host dropped");
      return false;
    }
    usedHosts.add(host);
    return true;
  };
  const uniqueCompetitors = rawCompetitors.filter((c) => reserveHost(c.url, "suggestion"));

  const validatedCompetitors = await Promise.all(
    uniqueCompetitors.map((c) => validateCompetitor(c, content_summary, marketRegion, confirmedNames, usedHosts, reserveHost)),
  );
  const ownKey = competitorKey(url);
  const seenCompetitorKeys = new Set<string>();
  const filteredCompetitors = validatedCompetitors.filter((competitor) => {
    const key = competitorKey(competitor.url);
    if (!key || key === ownKey || seenCompetitorKeys.has(key)) {
      duplicateHostDrops++;
      logger.info({ host: key, stage: "response", duplicateHostDrops }, "Prefill: duplicate competitor host dropped");
      return false;
    }
    seenCompetitorKeys.add(key);
    return true;
  });

  logger.info(
    {
      total: filteredCompetitors.length,
      verified: filteredCompetitors.filter((c) => c.verified).length,
      duplicateHostDrops,
    },
    "Prefill: validation complete",
  );

  // STEP 5 — Return enriched response
  res.json({
    personas,
    competitors: filteredCompetitors,
    content_summary,
    crawl_failed: crawlFailed,
    crawl_fail_reason: crawlFailReason,
  });
});

export default router;
