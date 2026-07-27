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
  | "unknown";

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
