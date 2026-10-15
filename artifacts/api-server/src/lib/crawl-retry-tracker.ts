import type { CrawlReliability } from "./crawler";
import { logger } from "./logger";

export interface RetryMetadata {
  transientStatus?: number | "timeout";
  retriesExhausted?: boolean;
}

/** Homepage discovery is exempt; only fully exhausted subpage fetches consume this budget. */
export function createCrawlRetryBudget(inputUrl: string) {
  let exhaustedUrls = 0;
  const host = new URL(inputUrl).hostname;
  return {
    allowsRetries: () => exhaustedUrls < 3,
    record(metadata: RetryMetadata, succeeded: boolean) {
      if (succeeded || !metadata.retriesExhausted || exhaustedUrls >= 3) return;
      exhaustedUrls++;
      if (exhaustedUrls === 3) logger.info({ host, exhaustedUrls }, "retry budget exhausted");
    },
  };
}

export type CrawlRetryBudget = ReturnType<typeof createCrawlRetryBudget>;

/** Counts logical fetches, not retry attempts; first-attempt evidence only. */
export function createCrawlRetryTracker() {
  let transientErrors = 0;
  let recoveredAfterRetry = 0;
  const byStatus: Record<string, number> = {};
  return {
    record(metadata: RetryMetadata, succeeded: boolean) {
      if (metadata.transientStatus === undefined) return;
      transientErrors++;
      if (succeeded) recoveredAfterRetry++;
      const status = String(metadata.transientStatus);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    },
    finish(reliability: CrawlReliability) {
      if (transientErrors === 0) return;
      Object.assign(reliability, { transientErrors, recoveredAfterRetry });
      logger.warn({ transientErrors, recoveredAfterRetry, attempted: reliability.attempted, byStatus },
        "transient server errors");
    },
  };
}
