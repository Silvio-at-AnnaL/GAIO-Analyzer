import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const logs = [];
globalThis.__crawlerTestLogs = logs;
const { outputFiles } = await build({
  entryPoints: [new URL("./crawler.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "crawler-test-logger",
    setup(builder) {
      builder.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
      builder.onResolve({ filter: /^\.\/logger$/ }, () => ({ path: "logger", namespace: "crawler-test" }));
      builder.onLoad({ filter: /.*/, namespace: "crawler-test" }, () => ({
        contents: `export const logger = Object.fromEntries(["info", "warn", "debug"].map(level =>
          [level, (obj, msg) => globalThis.__crawlerTestLogs.push({level, obj, msg})]));`,
        loader: "js",
      }));
    },
  }],
});
const { fetchWithTiming, fetchTechFile, crawlSite, fetchExplicitPages, detectPageLanguage, detectPageLanguageDetailed, determineSiteLanguage } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);
const diagnosticsBundle = await build({
  entryPoints: [new URL("./fetch-diagnostics.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "diagnostics-test-cheerio",
    setup(builder) {
      builder.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
    },
  }],
});
const { classifyFetchError } = await import(
  `data:text/javascript;base64,${Buffer.from(diagnosticsBundle.outputFiles[0].contents).toString("base64")}`
);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withServer(handler, run) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie });
    void Promise.resolve(handler(req, res)).catch(error => {
      res.destroy(error);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const previousFetch = globalThis.fetch;
  const dnsOrder = getDefaultResultOrder();
  setDefaultResultOrder("ipv4first");
  // Existing robots/llms URL construction omits the port. Route only those
  // local requests back to this ephemeral server; never allow internet access.
  globalThis.fetch = (url, options) => {
    const parsed = new URL(url);
    assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname), "tests must not access the internet");
    if (!parsed.port) parsed.port = String(port);
    assert.equal(parsed.port, String(port));
    return previousFetch(parsed, options);
  };
  logs.length = 0;
  try {
    await run({ origin, port, requests });
  } finally {
    globalThis.fetch = previousFetch;
    setDefaultResultOrder(dnsOrder);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test("cookie-gated self-redirect succeeds and keeps final-response timing and headers", async () => {
  await withServer((req, res) => {
    assert.equal(req.headers["user-agent"], "GAIOAnalyzer/1.0 (Website Audit Tool)");
    assert.equal(req.headers.accept, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    if (req.headers.cookie !== "session-test=accepted; mode=ok") {
      res.writeHead(302, { Location: req.url, "Set-Cookie": ["session-test=accepted; Path=/unrelated; HttpOnly", "mode=ok"] });
      res.end();
    } else {
      res.end("cookie accepted");
    }
  }, async ({ origin, requests }) => {
    const result = await fetchWithTiming(`${origin}/sitemap.xml`);
    assert.equal(result.statusCode, 200);
    assert.equal(result.html, "cookie accepted");
    assert.equal(result.finalUrl, `${origin}/sitemap.xml`);
    assert.ok(result.ttfb >= 0 && result.responseTime >= result.ttfb);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].cookie, undefined);
  });
});

test("endless redirects classify as redirect_loop and technical files make one attempt", async () => {
  await withServer((req, res) => {
    res.writeHead(302, { Location: req.url, "Set-Cookie": "never=accepted" });
    res.end();
  }, async ({ origin, requests }) => {
    await assert.rejects(fetchWithTiming(`${origin}/loop`), error => {
      assert.equal(error.cause.code, "REDIRECT_LOOP");
      assert.equal(classifyFetchError(error), "redirect_loop");
      return true;
    });
    assert.equal(requests.length, 11, "ten redirect hops after the initial request");
    requests.length = 0;
    const result = await fetchTechFile(`${origin}/loop`, 2000);
    assert.equal(result.status, "error");
    assert.equal(result.reason, "redirect_loop");
    assert.equal(requests.length, 11);
    assert.equal(logs.at(-1).obj.attempts, 1);
    assert.equal(logs.at(-1).obj.reason, "redirect_loop");
  });
});

test("cookies stay isolated by exact hostname and by fetch call", async () => {
  await withServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, {
        Location: `http://localhost:${req.headers.host.split(":")[1]}/other`,
        "Set-Cookie": "secret=host-a; Domain=localhost",
      });
    }
    res.end("body");
  }, async ({ origin, requests }) => {
    const result = await fetchWithTiming(`${origin}/start`);
    assert.equal(result.statusCode, 200);
    assert.ok(result.finalUrl.includes("localhost"));
    assert.equal(requests[1].cookie, undefined);
    await fetchWithTiming(`${origin}/independent`);
    assert.equal(requests[2].cookie, undefined);
  });
});

test("relative Location resolves against the current URL and missing Location ends the chain", async () => {
  await withServer((req, res) => {
    if (req.url === "/folder/start") res.writeHead(302, { Location: "../target?x=1" });
    if (req.url === "/no-location") res.writeHead(302);
    res.end(req.url);
  }, async ({ origin }) => {
    const result = await fetchWithTiming(`${origin}/folder/start`);
    assert.equal(result.finalUrl, `${origin}/target?x=1`);
    assert.equal(result.html, "/target?x=1");
    const noLocation = await fetchWithTiming(`${origin}/no-location`);
    assert.equal(noLocation.statusCode, 302);
    assert.equal(noLocation.html, "/no-location");
    assert.equal(noLocation.finalUrl, `${origin}/no-location`);
  });
});

test("a chain of exactly ten redirect hops is allowed", async () => {
  await withServer((req, res) => {
    const n = Number(req.url.slice(1));
    if (n < 10) res.writeHead(302, { Location: `/${n + 1}` });
    res.end("done");
  }, async ({ origin, requests }) => {
    const result = await fetchWithTiming(`${origin}/0`);
    assert.equal(result.statusCode, 200);
    assert.equal(result.finalUrl, `${origin}/10`);
    assert.equal(requests.length, 11);
  });
});

test("one overall timeout covers the redirect chain, including reading the final body", async () => {
  await withServer(async (req, res) => {
    if (req.url === "/start") {
      await delay(60);
      res.writeHead(302, { Location: "/slow-body" });
      res.end();
    } else {
      res.writeHead(200);
      res.flushHeaders();
      await delay(160);
      res.end("late");
    }
  }, async ({ origin }) => {
    const start = Date.now();
    await assert.rejects(fetchWithTiming(`${origin}/start`, 120));
    assert.ok(Date.now() - start < 250);
  });
});

test("5xx and 429 retry once while 404 remains missing without a retry", async () => {
  await withServer((req, res) => {
    res.writeHead(Number(req.url.slice(1)));
    res.end();
  }, async ({ origin, requests }) => {
    for (const status of [503, 429]) {
      requests.length = 0;
      const result = await fetchTechFile(`${origin}/${status}`, 2000);
      assert.equal(result.status, "error");
      assert.equal(requests.length, 2);
      assert.equal(logs.at(-1).obj.attempts, 2);
    }
    requests.length = 0;
    const missing = await fetchTechFile(`${origin}/404`, 2000);
    assert.equal(missing.status, "missing");
    assert.equal(requests.length, 1);
  });
});

test("redirect diagnostic supports undici messages and deterministic DNS/TLS failures never retry", async () => {
  assert.equal(classifyFetchError(new Error("fetch failed", { cause: new Error("redirect count exceeded") })), "redirect_loop");
  assert.equal(classifyFetchError(new Error("redirect count exceeded")), "redirect_loop");
  const previousFetch = globalThis.fetch;
  try {
    for (const [code, reason] of [
      ["ENOTFOUND", "dns"],
      ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_chain"],
      ["CERT_HAS_EXPIRED", "tls_other"],
    ]) {
      let attempts = 0;
      globalThis.fetch = async () => {
        attempts++;
        throw new Error("synthetic failure", { cause: { code } });
      };
      const result = await fetchTechFile("http://127.0.0.1/technical", 100);
      assert.equal(result.reason, reason);
      assert.equal(attempts, 1);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

const subpaths = ["/products/item", "/services/item", "/company/item", "/news/item"];
const homeHtml = `<html><body><h1>Home</h1>${subpaths.map(path => `<a href="${path}">${path}</a>`).join("")}</body></html>`;

async function technicalHandler(req, res) {
  if (req.url === "/robots.txt") {
    res.end("User-agent: *");
  } else if (req.url === "/llms.txt") {
    await delay(160);
    res.end("Synthetic technical file");
  } else if (req.url === "/") {
    res.end(homeHtml);
  } else if (subpaths.includes(req.url)) {
    res.end(`<html><body><h1>Distinct ${req.url}</h1><p>${req.url} content</p></body></html>`);
  } else {
    res.writeHead(404);
    res.end();
  }
}

test("technical budget skips sitemap steps and reserves time for all five competitor pages", async () => {
  await withServer(technicalHandler, async ({ origin, requests }) => {
    const result = await crawlSite(origin, 5, {
      deadlineMs: 40, techPhaseBudgetMs: 100, minPagePhaseMs: 500,
    });
    assert.equal(result.pages.length, 5);
    assert.equal(result.timedOut, false);
    assert.equal(result.sitemapStatus, "missing");
    assert.equal(result.robotsTxtExists, true);
    assert.equal(result.llmsTxtExists, true, "an in-flight technical request may finish");
    assert.ok(!requests.some(req => req.url.includes("sitemap")));
    const exhausted = logs.filter(log => log.msg === "technical phase budget exhausted");
    assert.equal(exhausted.length, 1);
    assert.ok(exhausted[0].obj.skipped.some(url => url.endsWith("/sitemap.xml")));
    assert.ok(result.techPhaseMs >= 160);
    assert.ok(result.pagePhaseMs >= 0);
  });
});

test("without new options the original deadline still includes the technical phase", async () => {
  await withServer(technicalHandler, async ({ origin, requests }) => {
    const result = await crawlSite(origin, 5, { deadlineMs: 40 });
    assert.equal(result.pages.length, 1);
    assert.equal(result.timedOut, true);
    assert.ok(requests.some(req => req.url === "/sitemap.xml"));
    assert.ok(!requests.some(req => subpaths.includes(req.url)));
    assert.equal(result.techPhaseMs, undefined);
    assert.equal(result.pagePhaseMs, undefined);
    assert.ok(!logs.some(log => log.msg === "technical phase budget exhausted"));
  });
});

test("slow robots consumes the budget but homepage remains exempt and unfetched llms stays missing", async () => {
  await withServer(async (req, res) => {
    if (req.url === "/robots.txt") {
      await delay(160);
      res.end("User-agent: *");
    } else {
      await technicalHandler(req, res);
    }
  }, async ({ origin, requests }) => {
    const result = await crawlSite(origin, 5, {
      deadlineMs: 40, techPhaseBudgetMs: 100, minPagePhaseMs: 500,
    });
    assert.equal(result.pages.length, 5);
    assert.equal(result.llmsTxtStatus, "missing");
    assert.equal(result.llmsTxt, null);
    assert.ok(!requests.some(req => req.url === "/llms.txt"));
    assert.ok(requests.some(req => req.url === "/"));
  });
});

test("sitemap index resolution stops queued technical requests when the budget expires", async () => {
  await withServer(async (req, res) => {
    if (req.url === "/robots.txt" || req.url === "/llms.txt") {
      res.writeHead(404);
      res.end();
    } else if (req.url === "/sitemap.xml") {
      const urls = Array.from({ length: 7 }, (_, i) =>
        `<sitemap><loc>http://${req.headers.host}/child-${i}.xml</loc></sitemap>`).join("");
      res.end(`<sitemapindex>${urls}</sitemapindex>`);
    } else if (req.url.startsWith("/child-")) {
      await delay(160);
      res.end("<urlset></urlset>");
    } else {
      await technicalHandler(req, res);
    }
  }, async ({ origin, requests }) => {
    const result = await crawlSite(origin, 5, {
      deadlineMs: 40, techPhaseBudgetMs: 100, minPagePhaseMs: 500,
    });
    assert.equal(requests.filter(req => req.url.startsWith("/child-")).length, 4);
    assert.equal(result.sitemapResolution.filesRead, 4);
    assert.equal(result.sitemapResolution.filesSkipped, 3);
    assert.equal(result.sitemapResolution.complete, false);
    assert.equal(result.pages.length, 5);
    assert.equal(logs.filter(log => log.msg === "technical phase budget exhausted").length, 1);
  });
});

test("HTML sitemap lookup starts no additional fetch after its in-flight request exhausts the budget", async () => {
  await withServer(async (req, res) => {
    if (req.url === "/robots.txt" || req.url === "/llms.txt") {
      res.writeHead(404);
      res.end();
    } else if (req.url === "/sitemap") {
      await delay(160);
      res.writeHead(404);
      res.end();
    } else {
      await technicalHandler(req, res);
    }
  }, async ({ origin, requests }) => {
    const result = await crawlSite(origin, 5, {
      deadlineMs: 40, techPhaseBudgetMs: 100, minPagePhaseMs: 500,
    });
    assert.ok(requests.some(req => req.url === "/sitemap"));
    assert.ok(!requests.some(req => req.url === "/sitemap/" || req.url === "/sitemap.html"));
    assert.equal(result.pages.length, 5);
  });
});

test("only competitor calls opt into both budgets, retaining five pages and a 45-second deadline", async () => {
  const source = await readFile(new URL("./analyzers/competitors.ts", import.meta.url), "utf8");
  assert.match(source, /COMPETITOR_MAX_PAGES = 5/);
  assert.match(source, /CRAWL_DEADLINE_MS = 45_000/);
  assert.match(source, /techPhaseBudgetMs: 20_000/);
  assert.match(source, /minPagePhaseMs: 20_000/);
  const warning = source.slice(source.indexOf('if (crawlResult.timedOut'), source.indexOf('"Competitor crawl returned fewer pages than requested"'));
  assert.match(warning, /techPhaseMs: crawlResult\.techPhaseMs/);
  assert.match(warning, /pagePhaseMs: crawlResult\.pagePhaseMs/);
  const mainSource = await readFile(new URL("./analysis-engine.ts", import.meta.url), "utf8");
  assert.doesNotMatch(mainSource, /techPhaseBudgetMs|minPagePhaseMs/);
});

const germanText = "Wir bieten die Produkte und Leistungen für unsere Kunden an. Die Lösungen werden mit einer sicheren Technik auf den Bedarf unserer Kunden abgestimmt. ";
const englishText = "The products and services are designed for you and your team with our technology. We offer the solutions that you have been looking for with more information about our company. ";
function languageHtml(declared, text, links = []) {
  return `<html${declared ? ` lang="${declared}"` : ""}><body><nav>${links.map(url => `<a href="${url}">${url}</a>`).join("")}</nav><main>${text}</main></body></html>`;
}
const languagePaths = [
  "/products/one", "/products/two", "/products/three",
  "/services/four", "/company/short", "/news/short",
];
function languageSite({ declared = "en", longHomepage = false, englishUrl = false, duplicate = false, mixedVotes = false } = {}) {
  const links = [...languagePaths, ...(englishUrl ? ["/en/english"] : [])];
  return (req, res) => {
    if (req.url === "/") {
      res.end(languageHtml(declared, longHomepage ? `${germanText.repeat(4)} Homepage` : "Willkommen", links));
    } else if (languagePaths.includes(req.url)) {
      const index = languagePaths.indexOf(req.url);
      const text = index >= 4 ? `Kurz ${index}` :
        `${(mixedVotes && (index === 1 || index === 3) ? englishText : germanText).repeat(4)} Seite ${duplicate && index === 1 ? 0 : index}`;
      res.end(languageHtml(declared, text));
    } else if (req.url === "/en/english") {
      res.end(languageHtml("en", englishText.repeat(4)));
    } else {
      res.writeHead(404);
      res.end();
    }
  };
}

test("detailed detection retains the original language decisions and exposes declaration and source", () => {
  for (const [html, expected] of [
    [languageHtml("en", germanText.repeat(4)), { lang: "de", source: "content", declared: "en" }],
    [languageHtml("DE-at", "Kurz"), { lang: "de", source: "declared", declared: "de" }],
    [languageHtml("en-US", "Short"), { lang: "en", source: "declared", declared: "en" }],
    [languageHtml("fr", "Court"), { lang: null, source: null, declared: "fr" }],
    [languageHtml(null, "Kurz"), { lang: null, source: null, declared: null }],
    [languageHtml("de", "xyz ".repeat(80)), { lang: null, source: null, declared: "de" }],
  ]) {
    assert.deepEqual(detectPageLanguageDetailed(html), expected);
    assert.equal(detectPageLanguage(html), expected.lang);
  }
});

test("Site A switches from a short English declaration to German, re-admits in fetch order without refetch and keeps short pages", async () => {
  await withServer(languageSite(), async ({ origin, requests }) => {
    const result = await crawlSite(origin, 16);
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "content", declared: "en", mismatch: true });
    assert.equal(result.pages.length, 7);
    assert.equal(result.skipped.otherLanguage, 0);
    const fetched = requests.filter(req => languagePaths.includes(req.url)).map(req => req.url);
    assert.equal(fetched.length, 6);
    assert.equal(new Set(fetched).size, 6);
    assert.deepEqual(result.pages.slice(1).map(page => new URL(page.url).pathname), fetched);
    assert.ok(result.pages.some(page => page.url.endsWith("/products/three")), "foreign branch hits must be cleared");
    assert.ok(result.pages.some(page => page.url.endsWith("/company/short")));
    assert.ok(result.pages.some(page => page.url.endsWith("/news/short")));
    const determined = logs.filter(log => log.msg === "site language determined");
    assert.equal(determined.length, 1);
    assert.equal(determined[0].obj.switched, true);
    assert.equal(determined[0].obj.readmittedPages, 2);
  });
});

test("Site B with a long German homepage preserves the page list and has no mismatch", async () => {
  await withServer(languageSite({ declared: "de", longHomepage: true }), async ({ origin }) => {
    const result = await crawlSite(origin, 16);
    const fixedTarget = await crawlSite(origin, 16, { preferredLang: "de" });
    assert.deepEqual(result.pages.map(page => page.url), fixedTarget.pages.map(page => page.url));
    assert.deepEqual(result.skipped, fixedTarget.skipped);
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "content", declared: "de", mismatch: false });
    assert.equal(result.pages.length, 7);
    assert.ok(logs.filter(log => log.msg === "site language determined").every(log => !log.obj.switched));
  });
});

test("Site C confirms a short German homepage from two content detections without changing the page list", async () => {
  await withServer(languageSite({ declared: "de" }), async ({ origin }) => {
    const result = await crawlSite(origin, 16);
    const fixedTarget = await crawlSite(origin, 16, { preferredLang: "de" });
    assert.deepEqual(result.pages.map(page => page.url), fixedTarget.pages.map(page => page.url));
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "content", declared: "de", mismatch: false });
    assert.ok(logs.filter(log => log.msg === "site language determined").every(log => !log.obj.switched));
  });
});

test("Site D still skips English URL-language pages on a German multilingual site", async () => {
  await withServer(languageSite({ declared: "de", longHomepage: true, englishUrl: true }), async ({ origin, requests }) => {
    const result = await crawlSite(origin, 16);
    assert.equal(result.pages.length, 7);
    assert.equal(result.skipped.otherLanguage, 1);
    assert.ok(result.skipped.urls.some(url => url.endsWith("/en/english")));
    assert.ok(!requests.some(req => req.url === "/en/english"));
    assert.equal(result.siteLanguage.mismatch, false);
  });
});

test("preferredLang preserves declaration-only filtering and never runs provisional switching", async () => {
  await withServer(languageSite(), async ({ origin }) => {
    const result = await crawlSite(origin, 16, { preferredLang: "de" });
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "preferred", declared: "en", mismatch: false });
    assert.equal(result.pages.length, 5);
    assert.equal(result.skipped.otherLanguage, 2);
    assert.equal(logs.find(log => log.msg === "site language determined").obj.switched, false);
  });
});

test("a content-confirmed mismatch on the homepage also keeps declaration-only subpages", async () => {
  await withServer(languageSite({ longHomepage: true }), async ({ origin }) => {
    const result = await crawlSite(origin, 16);
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "content", declared: "en", mismatch: true });
    assert.equal(result.pages.length, 7);
    assert.equal(logs.find(log => log.msg === "site language determined").obj.switched, false);
  });
});

test("mixed first two content votes retain the provisional declaration", async () => {
  await withServer(languageSite({ declared: "de", mixedVotes: true }), async ({ origin }) => {
    const result = await crawlSite(origin, 16);
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "declared", declared: "de", mismatch: false });
    assert.equal(result.skipped.otherLanguage, 2);
    assert.equal(logs.find(log => log.msg === "site language determined").obj.switched, false);
  });
});

test("re-admission uses duplicate fingerprints and respects the maximum page count", async () => {
  await withServer(languageSite({ duplicate: true }), async ({ origin, requests }) => {
    const result = await crawlSite(origin, 16);
    assert.equal(result.pages.length, 6);
    assert.equal(result.skipped.duplicate, 1);
    assert.equal(result.skipped.otherLanguage, 0);
    assert.equal(requests.filter(req => req.url === "/products/one").length, 1);
    assert.equal(requests.filter(req => req.url === "/products/two").length, 1);
    const capped = await crawlSite(origin, 2);
    assert.equal(capped.pages.length, 2);
    assert.equal(capped.siteLanguage.lang, "de");
    assert.equal(capped.skipped.otherLanguage, 0);
  });
});

test("explicit language uses content majority in the first five pages and detects declaration mismatches", () => {
  const de = declared => ({ html: languageHtml(declared, germanText.repeat(4)) });
  const en = declared => ({ html: languageHtml(declared, englishText.repeat(4)) });
  assert.deepEqual(determineSiteLanguage([de("en"), de("en")]), { lang: "de", source: "content", declared: "en", mismatch: true });
  assert.deepEqual(determineSiteLanguage([de("de"), de("de")]), { lang: "de", source: "content", declared: "de", mismatch: false });
  assert.deepEqual(determineSiteLanguage([de("en")]), { lang: "de", source: "content", declared: "en", mismatch: true });
  assert.equal(determineSiteLanguage([de("en"), de("en"), en("en"), en("en"), en("en")]).lang, "en");
  assert.deepEqual(determineSiteLanguage([de("en"), de("en"), en("en"), en("en")]), { lang: "en", source: "declared", declared: "en", mismatch: false });
  assert.deepEqual(determineSiteLanguage([de(null), en(null)]), { lang: null, source: null, declared: null, mismatch: false });
  assert.equal(determineSiteLanguage([de("en"), de("en"), de("en"), en("en"), en("en"), en("en"), en("en")]).lang, "de");
  assert.deepEqual(determineSiteLanguage([], languageHtml("de", "Kurz")), { lang: "de", source: "declared", declared: "de", mismatch: false });
  assert.deepEqual(determineSiteLanguage([en("de"), en("de")], languageHtml("en", "Home")), { lang: "en", source: "content", declared: "en", mismatch: false });
});

test("explicit fetch mode records site language but never filters selected pages", async () => {
  await withServer(languageSite(), async ({ origin }) => {
    const result = await fetchExplicitPages(origin, languagePaths.map(path => `${origin}${path}`));
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "content", declared: "en", mismatch: true });
    assert.equal(result.pages.length, 6);
    assert.deepEqual(result.pages.map(page => new URL(page.url).pathname), languagePaths);
    assert.equal(result.skipped.otherLanguage, 0);
  });
});
