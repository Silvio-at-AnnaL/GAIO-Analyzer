import { query } from "./db.js";
import { logger } from "./logger.js";
import { compileExclusionRules, type CrawlExclusionMatcher, type CrawlExclusionRule } from "./crawl-exclusions.js";

export const CRAWL_EXCLUSION_LOAD_ERROR = "Die Ausschlussliste für den Crawl konnte nicht geladen werden. Bitte versuchen Sie es später erneut.";

interface Snapshot {
  rules: CrawlExclusionRule[];
  matcher: CrawlExclusionMatcher;
  loadedAt: number;
}

let snapshot: Snapshot | null = null;
let invalidation = 0;
let pending: Promise<Snapshot> | null = null;
const CACHE_MS = 60_000;

export function invalidateCrawlExclusionCache(): void {
  invalidation++;
  if (snapshot) snapshot.loadedAt = 0;
  pending = null;
}

export async function getCrawlExclusionRules(): Promise<CrawlExclusionMatcher> {
  function log(value: Snapshot, source: "db" | "cache") {
    logger.info({
      total: value.rules.length,
      active: value.rules.filter(rule => rule.is_active).length,
      source,
    }, "crawl exclusion rules loaded");
  }
  if (snapshot && Date.now() - snapshot.loadedAt < CACHE_MS) {
    log(snapshot, "cache");
    return snapshot.matcher;
  }
  const version = invalidation;
  if (!pending) {
    const request = (async () => {
      const result = await query<CrawlExclusionRule>(
        "SELECT pattern, is_active, count_in_report FROM crawl_exclusion_rules ORDER BY id",
      );
      const value = { rules: result.rows, matcher: compileExclusionRules(result.rows), loadedAt: Date.now() };
      if (version === invalidation) snapshot = value;
      return value;
    })();
    pending = request;
    void request.finally(() => {
      if (pending === request) pending = null;
    }).catch(() => {});
  }
  try {
    const value = await pending;
    log(value, "db");
    return value.matcher;
  } catch (err) {
    if (!snapshot) throw err;
    logger.warn({ reason: err instanceof Error ? err.message : String(err) }, "crawl exclusion rules: using cached rules");
    log(snapshot, "cache");
    return snapshot.matcher;
  }
}
