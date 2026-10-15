import { logger } from "./logger";

export type HttpsRedirectStatus = "enforced" | "not_enforced" | "unknown";

export async function checkHttpsRedirect(inputUrl: string, timeoutMs = 10000): Promise<HttpsRedirectStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("fetch-timeout")), timeoutMs);
  try {
    const origin = new URL(inputUrl);
    origin.protocol = "http:";
    let current = origin.origin;
    let hops = 0;
    while (true) {
      controller.signal.throwIfAborted();
      const response = await fetch(current, {
        redirect: "manual", signal: controller.signal,
        headers: {
          "User-Agent": "GAIOAnalyzer/1.0 (Website Audit Tool)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      // Only the headers are needed; do not download the homepage again.
      await response.body?.cancel();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect_without_location");
        if (hops >= 5) throw new Error("redirect_hop_limit");
        current = new URL(location, current).href;
        if (!/^https?:$/.test(new URL(current).protocol)) throw new Error("unsupported_protocol");
        hops++;
        continue;
      }
      if (new URL(current).protocol === "https:") return "enforced";
      if (response.status >= 200 && response.status < 300) return "not_enforced";
      throw new Error(`http_${response.status}`);
    }
  } catch (err) {
    logger.warn({ url: inputUrl, reason: err instanceof Error ? err.message : String(err) }, "https redirect check failed");
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
