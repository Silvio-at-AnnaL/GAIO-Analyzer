export interface CrawlExclusionRule {
  pattern: string;
  is_active: boolean;
  count_in_report: boolean;
}

export interface CrawlExclusionMatcher {
  isExcluded(url: string): boolean;
  countsInReport(url: string): boolean;
}

export function normalizeExclusionPattern(pattern: string): string {
  return pattern.trim().normalize("NFC").toLowerCase();
}

function components(url: string): string[] {
  const parsed = new URL(url);
  const result = parsed.pathname.split("/").map(segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  for (const [name, value] of parsed.searchParams) {
    result.push(name, value, ...value.split("/"));
  }
  return result.filter(Boolean).map(value => value.normalize("NFC").toLowerCase());
}

export function compileExclusionRules(rules: readonly CrawlExclusionRule[]): CrawlExclusionMatcher {
  const compiled = rules.filter(rule => rule.is_active).map(rule => ({
    regex: new RegExp(`^${normalizeExclusionPattern(rule.pattern).split("*")
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*")}$`, "u"),
    counted: rule.count_in_report,
  }));
  function matches(url: string, countedOnly: boolean): boolean {
    const values = components(url);
    return compiled.some(rule => (!countedOnly || rule.counted) &&
      values.some(value => rule.regex.test(value)));
  }
  return {
    isExcluded: url => matches(url, false),
    countsInReport: url => matches(url, true),
  };
}
