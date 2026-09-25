import { getTitleFromHtml } from "./html-title";

/**
 * Classifies why a fetch() call failed, so the UI can report something
 * more useful than "could not be crawled".
 *
 * Node's fetch (undici) wraps the underlying network/TLS error in `.cause`,
 * so the real error code usually lives there, not on the top-level error.
 */
export type CrawlFailReason =
  | "tls_chain"
  | "tls_other"
  | "dns"
  | "refused"
  | "timeout"
  | "http_error"
  | "bot_protection"
  | "parked_domain"
  | "unknown";

const BOT_PROTECTION_TITLE =
  /^(just a moment\.\.\.|attention required!? \| cloudflare|checking your browser|ddos-guard|access denied)$/i;
const PARKED_DOMAIN_TEXT =
  /(domain|diese domain)[^.]{0,60}(steht zum verkauf|zu verkaufen|is for sale|for sale|kaufen sie)/;
const PARKING_PROVIDER_MARKERS = [
  "sedoparking",
  "sedo.com/search",
  "dan.com/buy-domain",
  "afternic",
  "elitedomains",
  "parkingcrew",
  "bodis.com",
];

export function detectBlockedContent(
  html: string,
  finalUrl?: string,
): "bot_protection" | "parked_domain" | null {
  const title = getTitleFromHtml(html);
  if (
    BOT_PROTECTION_TITLE.test(title) ||
    html.includes("window._cf_chl_opt") ||
    html.includes("_Incapsula_Resource")
  ) {
    return "bot_protection";
  }

  const lowerHtml = html.toLowerCase();
  const visibleText = lowerHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);
  if (
    PARKED_DOMAIN_TEXT.test(visibleText) ||
    PARKING_PROVIDER_MARKERS.some((marker) => lowerHtml.includes(marker))
  ) {
    return "parked_domain";
  }

  if (/captcha/i.test(title)) return "bot_protection";
  if (finalUrl) {
    try {
      const hostname = new URL(finalUrl).hostname.toLowerCase();
      if (hostname === "perfdrive.com" || hostname.endsWith(".perfdrive.com")) {
        return "bot_protection";
      }
    } catch {
      // An invalid final URL must not change the content classification.
    }
  }

  return null;
}

/** Server responded, but with a non-OK HTTP status (4xx/5xx). */
export function classifyHttpStatus(_status: number): CrawlFailReason {
  return "http_error";
}

export function classifyFetchError(err: unknown): CrawlFailReason {
  const e = err as { name?: string; code?: string; cause?: { code?: string } } | null;
  if (e?.name === "AbortError") return "timeout";

  const code = e?.cause?.code ?? e?.code;
  switch (code) {
    // Server sent the leaf certificate but not the intermediate(s).
    // Browsers paper over this (cached intermediates / AIA fetching), Node does not.
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return "tls_chain";
    case "CERT_HAS_EXPIRED":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "tls_other";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns";
    case "ECONNREFUSED":
    case "ECONNRESET":
      return "refused";
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
    case "ETIMEDOUT":
      return "timeout";
    default:
      return "unknown";
  }
}
