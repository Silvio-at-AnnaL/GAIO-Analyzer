type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Shared wording/conditions for the results card and the standalone report. */
export function crawlReliabilityNotices(
  reliability: Record<string, unknown>,
  evaluated: number,
  t: Translate,
): string[] {
  const notices: string[] = [];
  // Analyses saved before this metadata was introduced retain their old card.
  if (typeof reliability.timedOut !== "boolean") return notices;
  if (reliability.timedOut === true) {
    notices.push(t("results.crawl_timed_out", { n: evaluated, max: Number(reliability.maxPages ?? 16) }));
  }
  const failures = Array.isArray(reliability.failures) ? reliability.failures : [];
  const serverErrors = Number(reliability.serverErrors ?? failures.filter(failure => Number(failure.statusCode) >= 500 && Number(failure.statusCode) < 600).length);
  if (Number(reliability.failed) > 0 && serverErrors > Number(reliability.failed) / 2) {
    notices.push(t("results.crawl_server_errors", { count: serverErrors }));
  }
  return notices;
}
