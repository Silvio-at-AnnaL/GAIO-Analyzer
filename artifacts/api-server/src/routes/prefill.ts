import { Router, type IRouter } from "express";
import * as cheerio from "cheerio";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";

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

// ── Fetch with timeout ────────────────────────────────────────────────────────

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GAIOAnalyzer/1.0 (Website Audit Tool)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Mini-crawl for prefill (max 8 pages) ─────────────────────────────────────

interface PageContent {
  url: string;
  text: string;
}

async function miniCrawl(inputUrl: string, maxPages = 8): Promise<PageContent[]> {
  const base = new URL(inputUrl);
  const baseDomain = base.hostname;
  const results: PageContent[] = [];

  // Always fetch homepage first
  const homepageHtml = await fetchHtml(inputUrl, 10000);
  if (!homepageHtml) return results;

  const homepageText = extractText(homepageHtml);
  if (homepageText) results.push({ url: inputUrl, text: homepageText });

  // Discover and score internal links from homepage
  const links = extractInternalLinks(homepageHtml, inputUrl, baseDomain)
    .filter((u) => u !== inputUrl)
    .map((u) => ({ url: u, score: scorePrefillUrl(u) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPages - 1);

  // Fetch all discovered pages in parallel
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

  return results;
}

// ── Build content summary ─────────────────────────────────────────────────────

function buildContentSummary(pages: PageContent[], maxTotal = 8000): string {
  if (pages.length === 0) return "";
  const sections = pages.map((p) => `=== ${p.url} ===\n${p.text}`);
  let summary = sections.join("\n\n");
  if (summary.length > maxTotal) {
    // Truncate to max, keeping section headers intact
    summary = summary.slice(0, maxTotal) + "\n[content truncated]";
  }
  return summary;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function buildPrompt(
  company_name: string,
  url: string,
  crawledContent: string,
  crawlFailed: boolean,
): string {
  if (crawlFailed) {
    return `You are a B2B market research assistant. Analyze the following company and provide structured information.

Company: ${company_name}
Website: ${url}

NOTE: The website could not be crawled. Base your analysis on the company name, URL, and any general knowledge you have.

TASK 1 — TARGET AUDIENCES
Identify the primary B2B buyer personas. Include relevant industries, job titles/roles, and key buying criteria. Write 3-5 concise sentences in German.

TASK 2 — COMPETITORS
Identify 5-8 direct competitors — companies that sell similar products to the same target industries. Only list companies you are confident exist with real websites.

Return ONLY valid JSON, no other text:
{
  "content_summary": null,
  "personas": "<German prose, 3-5 sentences>",
  "competitors": [
    { "name": "<company>", "url": "https://..." }
  ]
}

All text must be in German. The personas field must be plain prose — no bullet points, no markdown.`;
  }

  return `You are a B2B market analyst.

A company has submitted its website for analysis. I have crawled the following pages from their website and extracted the text content:

${crawledContent}

Company name: ${company_name}
Website: ${url}

Based EXCLUSIVELY on the actual website content above (not on general assumptions), perform the following analysis:

TASK 1 — TARGET AUDIENCES
Identify the primary B2B buyer personas for this company based on the products, services and use cases described on the website. Include:
- Which industries are explicitly or implicitly addressed?
- Which job titles or roles are likely decision makers or users?
- What buying criteria or problems does the company solve?
Write 3-5 concise sentences in German. Be specific to what you actually read on the website — no generic B2B personas.

TASK 2 — COMPETITORS
Based on the specific products and services you found on this website, identify 5-8 direct competitors — companies that sell similar or identical products to the same target industries.

Rules for competitor selection:
- Must be direct product competitors, not adjacent or complementary companies
- Must be real companies with real websites you are confident exist
- Prefer companies of similar size and market focus where possible
- Do NOT list distributors, partners or customers of the analyzed company
- If you are uncertain about a URL, omit that competitor rather than guessing

Return ONLY valid JSON, no other text:
{
  "content_summary": "<2-3 sentences in German summarizing what products/services the company actually offers, based on the crawled pages>",
  "personas": "<German prose text, 3-5 sentences>",
  "competitors": [
    { "name": "<company>", "url": "https://..." }
  ]
}

CRITICAL: Base your analysis ONLY on the website content provided above. Do not use general knowledge about the company name. If the crawled content is insufficient to identify reliable competitors, return fewer than 5 rather than guessing.
All text fields must be in German. The personas field must be plain prose — no bullet points, no numbering, no markdown.`;
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

  try {
    pages = await miniCrawl(url, 8);
    crawlFailed = pages.length === 0;
    logger.info({ url, pageCount: pages.length, crawlFailed }, "Prefill: crawl complete");
  } catch (err) {
    logger.warn({ url, err }, "Prefill: crawl error — proceeding without content");
    crawlFailed = true;
  }

  // STEP 2 — Build content summary
  const crawledContent = buildContentSummary(pages, 8000);

  // STEP 3 — Call Claude
  const prompt = buildPrompt(company_name, url, crawledContent, crawlFailed);

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

    const personas = typeof parsed.personas === "string" ? stripMarkdown(parsed.personas) : "";

    const rawCompetitors = Array.isArray(parsed.competitors) ? parsed.competitors : [];
    const competitors = rawCompetitors
      .filter(
        (c): c is { name: string; url: string } =>
          c && typeof c === "object" && typeof c.name === "string" && typeof c.url === "string",
      )
      .map((c) => ({ name: c.name.trim(), url: normaliseUrl(c.url) ?? c.url }))
      .filter((c) => c.url.startsWith("http"));

    const content_summary =
      typeof parsed.content_summary === "string" && parsed.content_summary.trim()
        ? stripMarkdown(parsed.content_summary)
        : null;

    // STEP 4 — Return enriched response
    res.json({ personas, competitors, content_summary, crawl_failed: crawlFailed });
  } catch (err) {
    logger.error({ err }, "Prefill: AI call failed");
    res.status(500).json({ error: "AI service error" });
  }
});

export default router;
