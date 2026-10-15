import type { CrawlReliability } from "./crawler";
import { logger } from "./logger";

export interface RetryMetadata {
  transientStatus?: number | "timeout";
}

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
