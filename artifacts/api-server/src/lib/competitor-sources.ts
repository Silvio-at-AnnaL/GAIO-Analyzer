import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getSetting } from "./admin-db.js";
import { logger } from "./logger.js";
import { fillTemplate, getPrompt } from "./prompt-manager.js";

export type CandidateSourceName = "ai" | "search";

export interface RawCandidate {
  name: string;
  url: string;
  reason: string;
  origin: CandidateSourceName;
}

export const EXCLUDED_SOURCE_HOSTS = new Set([
  "wikipedia", "linkedin", "xing", "facebook", "instagram", "youtube",
  "amazon", "ebay", "wlw.de", "wer-liefert-was", "europages",
  "kompass.com", "gelbeseiten", "11880", "dnb.com", "northdata",
  "firmenwissen", "companyhouse", "yelp", "indeed", "stepstone",
  "glassdoor", "pinterest", "reddit", "quora",
]);

interface SearchResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

function normalizedHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function excludedHost(host: string): boolean {
  return [...EXCLUDED_SOURCE_HOSTS].some((excluded) =>
    host === excluded || host.endsWith(`.${excluded}`) ||
    (!excluded.includes(".") && host.split(".").includes(excluded)),
  );
}

export function parseSearchQueries(text: string): string[] {
  return text.split(/\r?\n/)
    .map((line) => /^\s*ANFRAGE:\s*(.+?)\s*$/i.exec(line)?.[1]?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 3);
}

// Optional dependencies let a throwaway verification script exercise the entire path
// without storing a test key or changing production settings.
interface SearchDependencies {
  readSetting?: typeof getSetting;
  generateQueries?: (prompt: string) => Promise<string>;
  fetcher?: typeof fetch;
}

export async function findCandidatesBySearch(
  companySummary: string,
  marketRegion: string,
  ownHost: string,
  dependencies: SearchDependencies = {},
): Promise<{ candidates: RawCandidate[]; queries: string[]; error?: string }> {
  let queries: string[] = [];
  try {
    const readSetting = dependencies.readSetting ?? getSetting;
    const provider = await readSetting("search_provider") ?? "tavily";
    const apiKey = await readSetting("search_api_key");
    if (!apiKey?.trim()) return { candidates: [], queries, error: "no_api_key" };
    if (provider !== "tavily") return { candidates: [], queries, error: "unsupported_provider" };

    const prompt = fillTemplate(await getPrompt("competitor-search-queries"), {
      COMPANY_SUMMARY: companySummary,
      MARKET_REGION: marketRegion,
    });
    const generateQueries = dependencies.generateQueries ?? (async (text: string) => {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: "user", content: text }],
      });
      return response.content.filter((block) => block.type === "text")
        .map((block) => (block as { type: "text"; text: string }).text).join("");
    });
    queries = parseSearchQueries(await generateQueries(prompt));
    if (queries.length === 0) {
      queries = [`${companySummary.trim().split(/\s+/).slice(0, 8).join(" ")} Anbieter ${marketRegion}`.trim()];
    }

    const candidates: RawCandidate[] = [];
    const seen = new Set([normalizedHost(ownHost)]);
    let rawResults = 0;
    let successfulQueries = 0;
    for (const query of queries.slice(0, 3)) {
      let results: SearchResult[];
      try {
        const response = await (dependencies.fetcher ?? fetch)("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey, query, search_depth: "basic", max_results: 8, include_answer: false,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`http_${response.status}`);
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) {
          throw new Error("invalid_results");
        }
        results = data.results as SearchResult[];
        successfulQueries++;
      } catch (error) {
        logger.info({ query, error: error instanceof Error ? error.message : "unknown" }, "Prefill: search query failed");
        continue;
      }
      rawResults += results.length;
      for (const result of results) {
        if (typeof result.url !== "string" || typeof result.title !== "string") continue;
        let url: URL;
        try { url = new URL(result.url); } catch { continue; }
        if (url.protocol !== "https:" && url.protocol !== "http:") continue;
        const host = normalizedHost(url.hostname);
        if (seen.has(host) || excludedHost(host)) continue;
        // "Kugellager-Express GmbH | Wälzlager online" must keep "Kugellager-Express GmbH".
        const name = result.title.split(/\s[|–—-]\s/, 1)[0].trim().slice(0, 60).trim() || host;
        seen.add(host);
        if (candidates.length < 8) {
          candidates.push({
            name,
            url: url.origin,
            reason: typeof result.content === "string" ? result.content.trim().slice(0, 140) : "",
            origin: "search",
          });
        }
      }
    }
    logger.info({ provider, queries, rawResults, kept: candidates.length }, "Prefill: search candidates");
    return successfulQueries === 0
      ? { candidates: [], queries, error: "all_queries_failed" }
      : { candidates, queries };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    return { candidates: [], queries, error: reason === "TimeoutError" ? "timeout" : reason.slice(0, 40) };
  }
}