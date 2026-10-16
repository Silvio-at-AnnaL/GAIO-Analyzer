import { query } from "./db.js";
import { drainUsageWrites } from "./usage-events.js";
import { logger } from "./logger.js";

export async function saveUsageSnapshot(logId: number): Promise<void> {
  try {
    await drainUsageWrites();
    // Shared preparation-only rows intentionally appear in each linked snapshot.
    // Summaries query the event table directly and therefore count those rows once.
    // calls and costUsd cover all matching rows; searchCostUsd is the search subset,
    // not an additional amount to add to costUsd.
    await query(`UPDATE analysis_log al SET usage_json = (
      SELECT jsonb_build_object('currency','USD',
        'analysis', jsonb_build_object(
          'calls', COUNT(*) FILTER (WHERE analysis_id=al.analysis_uuid),
          'inputTokens', COALESCE(SUM(input_tokens) FILTER (WHERE analysis_id=al.analysis_uuid),0),
          'outputTokens', COALESCE(SUM(output_tokens) FILTER (WHERE analysis_id=al.analysis_uuid),0),
          'costUsd', SUM(cost_usd) FILTER (WHERE analysis_id=al.analysis_uuid)),
        'preparation', jsonb_build_object(
          'calls', COUNT(*) FILTER (WHERE analysis_id IS NULL),
          'inputTokens', COALESCE(SUM(input_tokens) FILTER (WHERE analysis_id IS NULL),0),
          'outputTokens', COALESCE(SUM(output_tokens) FILTER (WHERE analysis_id IS NULL),0),
          'costUsd', SUM(cost_usd) FILTER (WHERE analysis_id IS NULL),
          'searchCredits', COALESCE(SUM(search_credits) FILTER (WHERE kind='search' AND analysis_id IS NULL),0),
          'searchCostUsd', SUM(cost_usd) FILTER (WHERE kind='search' AND analysis_id IS NULL)))
      FROM usage_events WHERE analysis_id=al.analysis_uuid
        OR (analysis_id IS NULL AND prep_id=al.prep_id)
    ) WHERE al.id=$1`, [logId]);
  } catch (err) {
    logger.error({ err, logId }, "usage snapshot failed");
  }
}
