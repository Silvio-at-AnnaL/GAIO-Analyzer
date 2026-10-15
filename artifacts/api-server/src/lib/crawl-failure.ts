import type { CrawlResult } from "./crawler";
import { analyzeRobotsTxt, type LlmCrawlerStatus } from "./analyzers/technical-seo";

export type CrawlErrorCode = "crawl_bot_protection" | "crawl_parked_domain" | "crawl_timed_out"
  | "crawl_no_selected_page" | "crawl_unreachable";

export interface BlockedRobotsHint {
  crawlers: LlmCrawlerStatus[];
  generalRule: "allowed" | "blocked" | "partial";
  fullyBlockedAgents: string[];
}

// Preserve the existing classification order and German log/old-client text.
export function describeCrawlFailure(crawl: CrawlResult, selected: boolean): {
  errorCode: CrawlErrorCode; message: string; blockedRobotsHint?: BlockedRobotsHint;
} {
  const errorCode: CrawlErrorCode = crawl.homepageFailReason === "bot_protection" ? "crawl_bot_protection"
    : crawl.homepageFailReason === "parked_domain" ? "crawl_parked_domain"
    : crawl.timedOut ? "crawl_timed_out" : selected ? "crawl_no_selected_page" : "crawl_unreachable";
  const messages: Record<CrawlErrorCode, string> = {
    crawl_bot_protection: "Crawl nicht möglich: Die Website blockiert automatisierte Zugriffe durch einen Bot-Schutz (z. B. Cloudflare). Für eine Analyse muss der Zugriff für den GAIO-Analyzer freigegeben werden.",
    crawl_parked_domain: "Crawl nicht möglich: Unter dieser Domain ist nur eine Park- bzw. Verkaufsseite erreichbar.",
    crawl_timed_out: "Crawl abgebrochen: Die Website antwortet zu langsam für eine automatisierte Analyse (Zeitlimit überschritten).",
    crawl_no_selected_page: "Crawl fehlgeschlagen: keine Seite konnte innerhalb des Zeitlimits geladen werden",
    crawl_unreachable: "Crawl fehlgeschlagen: Die Website konnte nicht abgerufen werden (nicht erreichbar oder blockiert automatisierte Zugriffe).",
  };
  if (errorCode !== "crawl_bot_protection" || crawl.robotsTxtStatus !== "found" || crawl.robotsTxt == null) {
    return { errorCode, message: messages[errorCode] };
  }
  const robots = analyzeRobotsTxt(crawl.robotsTxt);
  return { errorCode, message: messages[errorCode], blockedRobotsHint: {
    crawlers: robots.llmCrawlers,
    generalRule: robots.generalRule,
    fullyBlockedAgents: [...new Set(robots.siteBlockedAgents)],
  } };
}
