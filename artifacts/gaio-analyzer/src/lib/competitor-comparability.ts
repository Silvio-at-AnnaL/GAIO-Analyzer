export const MIN_COMPARABLE_PAGES = 3;

export function isLimitedCompetitor(competitor: {
  crawledPagesCount: number;
  error?: string | null;
}): boolean {
  return !competitor.error &&
    competitor.crawledPagesCount > 0 &&
    competitor.crawledPagesCount < MIN_COMPARABLE_PAGES;
}
