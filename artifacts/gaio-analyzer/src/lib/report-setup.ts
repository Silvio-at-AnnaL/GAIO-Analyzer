export type ReportSetup = {
  url: string | null;
  companyName: string | null;
  persona: string | null;
  competitors: string[];
  pages: string[];
  requestedPages: string[] | null;
  pageSelection: "manual" | "auto" | null;
  analysisId: string | null;
  exportDate: string | null;
};

export type ReportSetupResult =
  | {
      ok: true;
      source: "block-v2" | "fallback";
      setup: ReportSetup;
      warnings: string[];
    }
  | {
      ok: false;
      reason: "not_a_report" | "html_mode" | "no_setup_data" | "failed_report" | "no_pages";
    };

type DataBlock = {
  present: boolean;
  value: Record<string, unknown> | null;
};

const ANALYSIS_PARAMETERS_HEADING = "Analyseparameter dieser Auswertung";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      const lowerEntity = entity.toLowerCase();
      if (lowerEntity === "&amp;") return "&";
      if (lowerEntity === "&lt;") return "<";
      if (lowerEntity === "&gt;") return ">";
      if (lowerEntity === "&quot;") return '"';
      if (lowerEntity === "&#39;") return "'";

      const numeric = lowerEntity.startsWith("&#x")
        ? Number.parseInt(lowerEntity.slice(3, -1), 16)
        : Number.parseInt(lowerEntity.slice(2, -1), 10);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) {
        return entity;
      }

      try {
        return String.fromCodePoint(numeric);
      } catch {
        return entity;
      }
    },
  );
}

function htmlText(markup: string): string {
  return decodeHtmlEntities(
    markup
      .replace(/<br\b[^>]*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]*\n[ \t\f\v]*/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .trim(),
  );
}

function readDataBlock(html: string): DataBlock {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let scriptMatch: RegExpExecArray | null;

  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    const idMatch = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(
      scriptMatch[1],
    );
    if ((idMatch?.[1] ?? idMatch?.[2] ?? idMatch?.[3]) !== "gaio-analysis-data") {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(scriptMatch[2]);
      return { present: true, value: isRecord(parsed) ? parsed : null };
    } catch {
      return { present: true, value: null };
    }
  }

  return { present: false, value: null };
}

function findAnalysisParametersHeading(html: string): RegExpExecArray | null {
  const headingPattern = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi;
  let headingMatch: RegExpExecArray | null;

  while ((headingMatch = headingPattern.exec(html)) !== null) {
    if (htmlText(headingMatch[1]).replace(/\s+/g, " ") === ANALYSIS_PARAMETERS_HEADING) {
      return headingMatch;
    }
  }

  return null;
}

function readParameterRows(html: string, heading: RegExpExecArray): Map<string, string> {
  const followingHtml = html.slice(heading.index + heading[0].length);
  const tableMatch = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/i.exec(followingHtml);
  const values = new Map<string, string>();
  if (!tableMatch) return values;

  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(tableMatch[1])) !== null) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)];
    if (cells.length < 2) continue;
    const label = htmlText(cells[0][1]).replace(/\s+/g, " ");
    if (!values.has(label)) values.set(label, cells[1][1]);
  }

  return values;
}

function readHref(attributes: string): string | null {
  const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attributes);
  const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];
  return href === undefined ? null : nonEmptyString(decodeHtmlEntities(href).trim());
}

function linksIn(markup: string): string[] {
  const links: string[] = [];
  const linkPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkPattern.exec(markup)) !== null) {
    const href = readHref(linkMatch[1]);
    if (href !== null) links.push(href);
  }
  return links;
}

function textFromRow(values: Map<string, string>, label: string): string | null {
  const value = values.get(label);
  return value === undefined ? null : nonEmptyString(htmlText(value));
}

function domainFromRow(values: Map<string, string>): string | null {
  const markup = values.get("Analysierte Domain");
  return markup === undefined ? null : linksIn(markup)[0] ?? null;
}

function competitorsFromRow(values: Map<string, string>): string[] {
  const markup = values.get("Wettbewerber-Domains");
  return markup === undefined ? [] : linksIn(markup);
}

function readCrawledPages(html: string): {
  pages: string[];
  count: number | null;
  listFound: boolean;
} {
  const elementPattern = /<(div|h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let elementMatch: RegExpExecArray | null;

  while ((elementMatch = elementPattern.exec(html)) !== null) {
    const text = htmlText(elementMatch[2]).replace(/\s+/g, " ");
    const headingMatch = /^Gecrawlte Seiten\s*\((\d+)\)$/.exec(text);
    if (!headingMatch) continue;

    const afterHeading = html.slice(elementMatch.index + elementMatch[0].length);
    const listMatch = /^\s*<ul\b[^>]*>([\s\S]*?)<\/ul\s*>/i.exec(afterHeading);
    if (!listMatch) {
      return { pages: [], count: Number(headingMatch[1]), listFound: false };
    }

    return {
      pages: linksIn(listMatch[1]),
      count: Number(headingMatch[1]),
      listFound: true,
    };
  }

  return { pages: [], count: null, listFound: false };
}

function oldBlockString(block: Record<string, unknown> | null, key: string): string | null {
  return block ? nullableString(block[key]) : null;
}

function requestedPagesWarning(requestedPages: string[] | null, pages: string[]): boolean {
  if (requestedPages === null) return false;
  const analyzedPages = new Set(pages.map(normalizePageUrl));
  return requestedPages.some((page) => !analyzedPages.has(normalizePageUrl(page)));
}

/**
 * Normalizes only URL scheme/host/default-port/path-root equivalences used when
 * comparing requested and analyzed pages. Path suffixes, queries and fragments
 * are kept byte-for-byte rather than being serialized through URL.
 */
export function normalizePageUrl(url: string): string {
  const match = /^([a-z][a-z\d+.-]*):\/\/([^/?#]*)([^?#]*)([\s\S]*)$/i.exec(url);
  if (!match) return url;

  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const atIndex = authority.lastIndexOf("@");
  const userInfo = atIndex === -1 ? "" : authority.slice(0, atIndex + 1);
  const hostPort = authority.slice(atIndex + 1);

  let host: string;
  let port: string;
  if (hostPort.startsWith("[")) {
    const closingBracket = hostPort.indexOf("]");
    if (closingBracket === -1) return url;
    host = hostPort.slice(0, closingBracket + 1);
    port = hostPort.slice(closingBracket + 1);
  } else {
    const portSeparator = hostPort.lastIndexOf(":");
    if (portSeparator !== -1 && /^\:\d+$/.test(hostPort.slice(portSeparator))) {
      host = hostPort.slice(0, portSeparator);
      port = hostPort.slice(portSeparator);
    } else {
      host = hostPort;
      port = "";
    }
  }

  const isDefaultPort = (scheme === "http" && /^:80$/.test(port))
    || (scheme === "https" && /^:443$/.test(port));
  const path = match[3] || "/";
  return `${scheme}://${userInfo}${host.toLowerCase()}${isDefaultPort ? "" : port}${path}${match[4]}`;
}

function parseVersionTwo(block: Record<string, unknown>): ReportSetupResult {
  if (block.status === "failed") return { ok: false, reason: "failed_report" };
  if (block.mode === "html") return { ok: false, reason: "html_mode" };

  const url = nullableString(block.url);
  if (url === null) return { ok: false, reason: "no_setup_data" };

  const competitors = stringArray(block.competitors) ?? [];
  const pages = stringArray(block.pages) ?? [];
  const requestedPages = block.requestedPages === null
    ? null
    : stringArray(block.requestedPages);
  if (pages.length === 0) return { ok: false, reason: "no_pages" };
  const persona = nullableString(block.persona);
  const warnings: string[] = [];

  if (requestedPagesWarning(requestedPages, pages)) {
    warnings.push("requested_pages_not_analyzed");
  }
  if (persona === null) warnings.push("persona_not_found");
  if (competitors.length > 5) warnings.push("competitors_truncated");

  return {
    ok: true,
    source: "block-v2",
    setup: {
      url,
      companyName: nullableString(block.companyName),
      persona,
      competitors,
      pages,
      requestedPages,
      pageSelection: block.pageSelection === "manual" || block.pageSelection === "auto"
        ? block.pageSelection
        : null,
      analysisId: nullableString(block.analysisId),
      exportDate: nullableString(block.exportDate),
    },
    warnings,
  };
}

function parseFallback(
  block: Record<string, unknown> | null,
  html: string,
  heading: RegExpExecArray | null,
): ReportSetupResult {
  const parameterRows = heading ? readParameterRows(html, heading) : new Map<string, string>();
  const crawled = readCrawledPages(html);

  const url = domainFromRow(parameterRows)
    ?? oldBlockString(block, "url")
    ?? oldBlockString(block, "domain");
  if (url === null) return { ok: false, reason: "no_setup_data" };
  if (crawled.pages.length === 0) return { ok: false, reason: "no_pages" };

  const visibleCompanyName = textFromRow(parameterRows, "Unternehmensname");
  const persona = textFromRow(parameterRows, "Zielgruppen / Käuferpersonas");
  const competitors = competitorsFromRow(parameterRows);
  const warnings: string[] = [];
  if (crawled.count !== null && crawled.count !== crawled.pages.length) {
    warnings.push("page_count_mismatch");
  }
  if (persona === null) warnings.push("persona_not_found");
  if (competitors.length > 5) warnings.push("competitors_truncated");

  return {
    ok: true,
    source: "fallback",
    setup: {
      url,
      companyName: visibleCompanyName ?? oldBlockString(block, "companyName"),
      persona,
      competitors,
      pages: crawled.pages,
      requestedPages: null,
      pageSelection: null,
      analysisId: null,
      exportDate: oldBlockString(block, "exportDate"),
    },
    warnings,
  };
}

/**
 * Reads the versioned setup data block when available, or recovers the visible
 * setup fields from legacy HTML report markup.
 */
export function parseReportSetup(html: string): ReportSetupResult {
  if (typeof html !== "string") return { ok: false, reason: "not_a_report" };

  const dataBlock = readDataBlock(html);
  const block = dataBlock.value;
  if (block?.blockVersion === 2) return parseVersionTwo(block);

  const heading = findAnalysisParametersHeading(html);
  if (!dataBlock.present && heading === null) {
    return { ok: false, reason: "not_a_report" };
  }

  return parseFallback(block, html, heading);
}