import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const logs = [];
const seedOptions = { skipTechFiles: true };
globalThis.__crawlerTestLogs = logs;
const { outputFiles } = await build({
  entryPoints: [new URL("./crawler.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "crawler-test-logger",
    setup(builder) {
      // Page-selection/retry fixtures count homepage hits. The independent HTTP
      // probe is exercised against real local HTTP/TLS servers in https-redirect.test.mjs.
      builder.onResolve({ filter: /^\.\/https-redirect$/ }, () => ({ path: "https-probe", namespace: "https-probe" }));
      builder.onLoad({ filter: /.*/, namespace: "https-probe" }, () => ({
        contents: `export const checkHttpsRedirect = async () => "unknown";`,
      }));
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
const { fetchWithTiming, fetchTechFile, fetchPage, crawlSite: realCrawlSite, fetchExplicitPages, detectPageLanguage, detectPageLanguageDetailed, determineSiteLanguage, isNonContentPage, isThinPage } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);
const seedBundle = await build({
  stdin: {
    contents: `export { compileExclusionRules } from "./crawl-exclusions.ts";
      export { CRAWL_EXCLUSION_SEED } from "./crawl-exclusion-seed.ts";`,
    resolveDir: new URL(".", import.meta.url).pathname, loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { compileExclusionRules, CRAWL_EXCLUSION_SEED } = await import(
  `data:text/javascript;base64,${Buffer.from(seedBundle.outputFiles[0].contents).toString("base64")}`
);
const seedMatcher = compileExclusionRules(CRAWL_EXCLUSION_SEED.map(rule => ({ ...rule, is_active: true })));
const crawlSite = (url, limit = 16, options = {}) => realCrawlSite(url, limit, {
  exclusionMatcher: seedMatcher, ...options,
});

test("crawlSite rejects a missing matcher before fetching", async () => {
  await assert.rejects(realCrawlSite("https://example.test", 16, {}), /requires an exclusion matcher/);
});
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

for (const mode of ["explicit", "crawl"]) {
  test(`${mode}: 502 then 200 counts the recovered page once and records one retry`, async () => {
    let hits = 0;
    await withServer((req, res) => {
      if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), ["/products/one"]));
      else if (req.url === "/products/one") {
        if (++hits === 1) { res.writeHead(502); res.end("temporary"); }
        else res.end(languageHtml("de", `Produkte ${germanText.repeat(5)}`));
      } else { res.writeHead(404); res.end(); }
    }, async ({ origin }) => {
      const result = mode === "explicit"
        ? await fetchExplicitPages(origin, [`${origin}/products/one`], seedOptions)
        : await crawlSite(origin, 2, { mainSite: true });
      assert.equal(hits, 2);
      assert.equal(result.reliability.attempted, mode === "explicit" ? 1 : 2);
      assert.equal(result.reliability.succeeded, mode === "explicit" ? 1 : 2);
      assert.equal(result.reliability.failed, 0);
      assert.equal(result.reliability.transientErrors, 1);
      assert.equal(result.reliability.recoveredAfterRetry, 1);
      const warning = logs.filter(log => log.msg === "transient server errors");
      assert.equal(warning.length, 1);
      assert.equal(warning[0].level, "warn");
      assert.deepEqual(warning[0].obj, { transientErrors: 1, recoveredAfterRetry: 1,
        attempted: result.reliability.attempted, byStatus: { 502: 1 } });
      const retries = logs.filter(log => log.msg === "Retrying page fetch");
      assert.equal(retries.length, 1);
      assert.equal(retries[0].obj.retries, 1);
      assert.equal(retries[0].obj.statusCode, 502);
      assert.equal(retries[0].obj.delayMs, 2000);
      if (mode === "explicit") assert.equal(result.pages[0].retries, 1);
    });
  });
}

test("three 502 responses produce one final failure with status 502 and retries 2", async () => {
  let hits = 0;
  await withServer((req, res) => { hits++; res.writeHead(502); res.end("temporary"); }, async ({ origin }) => {
    const result = await fetchExplicitPages(origin, [origin], seedOptions);
    assert.equal(hits, 3);
    assert.deepEqual(result.reliability, {
      attempted: 1, succeeded: 0, failed: 1,
      transientErrors: 1, recoveredAfterRetry: 0,
      failures: [{ url: origin, reason: "http_error", statusCode: 502, retries: 2 }],
    });
    assert.deepEqual(logs.filter(log => log.msg === "Retrying page fetch").map(log => log.obj.delayMs), [2000, 4000]);
  });
});

test("503 with insufficient deadline returns its final HTTP outcome without retrying", async () => {
  let hits = 0;
  await withServer((req, res) => { hits++; res.writeHead(503); res.end("temporary"); }, async ({ origin }) => {
    const page = await fetchPage(origin, { deadline: Date.now() + 250 });
    assert.equal(hits, 1);
    assert.equal(page.statusCode, 503);
    assert.equal(page.retries, 0);
    assert.ok(!logs.some(log => log.msg === "Retrying page fetch"));
    assert.ok(!logs.some(log => log.msg === "transient server errors"));
  });
});

test("429 honours Retry-After: 1 before succeeding", async () => {
  const times = [];
  await withServer((req, res) => {
    times.push(Date.now());
    if (times.length === 1) { res.writeHead(429, { "Retry-After": "1" }); res.end("slow down"); }
    else res.end(languageHtml("de", germanText.repeat(4)));
  }, async ({ origin }) => {
    const result = await fetchExplicitPages(origin, [origin], seedOptions);
    assert.equal(result.reliability.attempted, 1);
    assert.equal(result.reliability.succeeded, 1);
    assert.equal(result.pages[0].retries, 1);
    assert.equal(result.reliability.transientErrors, 1);
    assert.equal(result.reliability.recoveredAfterRetry, 1);
    assert.deepEqual(logs.find(log => log.msg === "transient server errors").obj.byStatus, { 429: 1 });
    assert.ok(times[1] - times[0] >= 950);
    assert.ok(times[1] - times[0] < 2500);
  });
});

for (const recover of [true, false]) {
  test(`first-attempt timeout is counted once, ${recover ? "recovered" : "unrecovered"}, and logged in the crawl WARN`, async () => {
    await withServer((req, res) => {
      if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4)));
      else { res.writeHead(404); res.end(); }
    }, async ({ origin }) => {
      const realFetch = globalThis.fetch;
      let hits = 0;
      globalThis.fetch = (url, options) => {
        if (String(url) === `${origin}/` && (++hits === 1 || !recover)) return Promise.reject(new Error("fetch-timeout"));
        return realFetch(url, options);
      };
      try {
        const result = await crawlSite(`${origin}/`, 1, { mainSite: true });
        assert.equal(hits, 2);
        assert.equal(result.reliability.transientErrors, 1);
        assert.equal(result.reliability.recoveredAfterRetry, recover ? 1 : 0);
        const warnings = logs.filter(log => log.msg === "transient server errors");
        assert.equal(warnings.length, 1);
        assert.deepEqual(warnings[0].obj, {
          transientErrors: 1, recoveredAfterRetry: recover ? 1 : 0, attempted: 1, byStatus: { timeout: 1 },
        });
      } finally { globalThis.fetch = realFetch; }
    });
  });
}

test("multiple recovered page fetches emit one aggregate transient WARN grouped by first status", async () => {
  const hits = new Map();
  await withServer((req, res) => {
    const count = (hits.get(req.url) ?? 0) + 1;
    hits.set(req.url, count);
    if (count === 1) {
      res.writeHead(req.url === "/one" ? 502 : 429, { "Retry-After": "0" }); res.end("temporary");
    } else res.end(languageHtml("de", germanText.repeat(4)));
  }, async ({ origin }) => {
    const result = await fetchExplicitPages(origin, [`${origin}/one`, `${origin}/two`], seedOptions);
    assert.equal(result.reliability.attempted, 2);
    assert.equal(result.reliability.succeeded, 2);
    assert.equal(result.reliability.transientErrors, 2);
    assert.equal(result.reliability.recoveredAfterRetry, 2);
    assert.deepEqual(logs.filter(log => log.msg === "transient server errors"), [{
      level: "warn", msg: "transient server errors",
      obj: { transientErrors: 2, recoveredAfterRetry: 2, attempted: 2, byStatus: { 502: 1, 429: 1 } },
    }]);
  });
});

test("scaled main technical budget preserves a full page reservation and logs an early end", async () => {
  await withServer(async (req, res) => {
    if (req.url === "/robots.txt") { await delay(80); res.end("User-agent: *"); }
    else if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), ["/products/one", "/services/two"]));
    else if (req.url.startsWith("/products/") || req.url.startsWith("/services/")) {
      await delay(300);
      res.end(languageHtml("de", `${req.url} ${germanText.repeat(5)}`));
    } else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const result = await crawlSite(origin, 4, {
      mainSite: true, deadlineMs: 90, techPhaseBudgetMs: 30, minPagePhaseMs: 450,
    });
    assert.ok(result.techPhaseMs >= 80);
    assert.ok(result.pagePhaseMs >= 440, "page phase retains the 450ms reservation after slow technical files");
    assert.ok(!requests.some(req => req.url === "/sitemap.xml"));
    assert.ok(requests.some(req => req.url.startsWith("/products/")));
    assert.equal(result.timedOut, true);
    const warnings = logs.filter(log => log.msg === "main crawl ended early");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].level, "warn");
    assert.deepEqual(warnings[0].obj, {
      reason: "deadline", pages: result.pages.length, requested: 4,
      attempted: result.reliability.attempted, failed: result.reliability.failed,
      techPhaseMs: result.techPhaseMs, pagePhaseMs: result.pagePhaseMs,
    });
  });
});

for (const source of ["homepage", "sitemap"]) {
  test(`${source} uses snapshot rules and counts only counted matches, leaving explicit pages unfiltered`, async () => {
    await withServer((req, res) => {
      if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), source === "homepage" ? ["/versand", "/file.pdf", "/products"] : []));
      else if (req.url === "/sitemap.xml") res.end(source === "sitemap"
        ? `<urlset>${["versand", "file.pdf", "products"].map(part => `<url><loc>http://${req.headers.host}/${part}</loc></url>`).join("")}</urlset>`
        : "<urlset></urlset>");
      else if (req.url === "/products") res.end(languageHtml("de", `Produkte ${germanText.repeat(5)}`));
      else if (req.url === "/versand") res.end(languageHtml("de", `Versand ${germanText.repeat(6)}`));
      else { res.writeHead(404); res.end(); }
    }, async ({ origin, requests }) => {
      const result = await crawlSite(origin, 16);
      assert.ok(result.pages.some(page => page.url === `${origin}/products`));
      assert.ok(!requests.some(request => ["/versand", "/file.pdf"].includes(request.url)));
      assert.equal(result.skipped.excludedPath, 1);
      const explicit = await fetchExplicitPages(origin, [`${origin}/versand`], seedOptions);
      assert.deepEqual(explicit.pages.map(page => page.url), [`${origin}/versand`]);
    });
  });
}

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

function fillFixture(req, res) {
  const path = req.url;
  if (path === "/robots.txt" || path === "/llms.txt") { res.end("Synthetic technical file"); return; }
  if (path.includes("sitemap")) { res.writeHead(404); res.end(); return; }
  const links = ["products", "services", "solutions", "industries", "company"]
    .flatMap(category => Array.from({ length: 8 }, (_, index) => `/${category}/${index}`));
  res.end(languageHtml("de", `${path} ${germanText.repeat(4)}`, path === "/" ? ["/products/removed", ...links] : []));
}

test("queryless exclusions cover query variants from homepage links and XML sitemap candidates", async () => {
  const blocked = "/de/kontakt?productid=1&cHash=x";
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), [blocked, "/de/kontakt-extra"]));
    else if (req.url === "/sitemap.xml") res.end(`<urlset><url><loc>http://${req.headers.host}/de/kontakt?productid=2&amp;cHash=y</loc></url></urlset>`);
    else if (req.url === "/de/selected" || req.url === "/de/kontakt-extra") res.end(languageHtml("de", `${req.url} ${germanText.repeat(4)}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const selected = await fetchExplicitPages(origin, [`${origin}/de/selected`], seedOptions);
    const result = await crawlSite(origin, 16, { seedPages: selected.pages, excludeUrls: [`${origin}/de/kontakt/#fragment`], preferredLang: "de" });
    assert.ok(!requests.some(request => request.url.startsWith("/de/kontakt?")));
    assert.ok(!result.pages.some(page => new URL(page.url).pathname === "/de/kontakt"));
    assert.ok(result.pages.some(page => page.url === `${origin}/de/kontakt-extra`), "path matching must not be a prefix match");
    assert.ok(result.skipped.excludedPath >= 2);
    assert.ok(result.skipped.urls.includes(`${origin}${blocked}`));
  });
});

test("query-specific exclusions leave other queries on the same path allowed", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), ["/de/x?a=1", "/de/x?a=2"]));
    else if (req.url === "/de/x?a=2") res.end(languageHtml("de", `Second query ${germanText.repeat(4)}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const result = await crawlSite(origin, 4, { excludeUrls: [`${origin}/de/x?a=1#ignored`] });
    assert.ok(!requests.some(request => request.url === "/de/x?a=1"));
    assert.ok(requests.some(request => request.url === "/de/x?a=2"));
    assert.ok(result.pages.some(page => page.url === `${origin}/de/x?a=2`));
    assert.ok(result.skipped.excludedPath >= 1);
  });
});

test("exclusions do not remove selected seeds, including selected query variants", async () => {
  await withServer(fillFixture, async ({ origin }) => {
    const seed = { url: `${origin}/de/kontakt?a=2`, html: languageHtml("de", germanText.repeat(4)), statusCode: 200 };
    const result = await crawlSite(origin, 1, { seedPages: [seed], excludeUrls: [`${origin}/de/kontakt`] });
    assert.deepEqual(result.pages, [seed]);
  });
});

for (const source of ["homepage", "page loop"]) {
  test(`${source} discovery resolves relative links against the redirect destination with its trailing slash`, async () => {
    await withServer((req, res) => {
      if (req.url === "/de") { res.writeHead(302, { Location: "/de/" }); res.end(); }
      else if (req.url === "/") res.end(languageHtml("de", `Root ${germanText.repeat(4)}`, ["/de"]));
      else if (req.url === "/de/") res.end(languageHtml("de", `Directory ${germanText.repeat(4)}`, ["produkte"]));
      else if (req.url === "/de/produkte") res.end(languageHtml("de", `Products ${germanText.repeat(4)}`));
      else { res.writeHead(404); res.end(); }
    }, async ({ origin, requests }) => {
      const result = await crawlSite(source === "homepage" ? `${origin}/de` : origin, 5);
      assert.ok(requests.some(request => request.url === "/de/produkte"));
      assert.ok(!requests.some(request => request.url === "/produkte"));
      assert.ok(result.pages.some(page => page.url === `${origin}/de/produkte`));
      assert.equal(result.pages.find(page => page.url === `${origin}/de`)?.finalUrl, `${origin}/de/`);
    });
  });
}

for (const base of ["absolute", "relative", "non-http", "first only", "invalid first"]) {
  test(`HTML link discovery honours ${base} base href on a crawled page`, async () => {
    await withServer((req, res) => {
      if (req.url === "/") res.end(languageHtml("de", `Root ${germanText.repeat(4)}`, ["/de/start/x"]));
      else if (req.url === "/de/start/x") {
        const bases = {
          absolute: `<base href="http://${req.headers.host}/de/">`,
          relative: '<base href="../">',
          "non-http": '<base href="javascript:alert(1)">',
          "first only": '<base href="/de/"><base href="/wrong/">',
          "invalid first": '<base href="mailto:test@example.test"><base href="/de/">',
        };
        res.end(`<html lang="de"><head>${bases[base]}</head><body><h1>Start</h1><p>${germanText.repeat(4)}</p><a href="produkte">Produkte</a></body></html>`);
      } else if (req.url === "/de/produkte" || req.url === "/de/start/produkte") res.end(languageHtml("de", `Products ${germanText.repeat(4)}`));
      else { res.writeHead(404); res.end(); }
    }, async ({ origin, requests }) => {
      const expected = ["non-http", "invalid first"].includes(base) ? "/de/start/produkte" : "/de/produkte";
      const result = await crawlSite(origin, 5);
      assert.ok(requests.some(request => request.url === expected));
      assert.ok(result.pages.some(page => page.url === `${origin}${expected}`));
      assert.ok(!requests.some(request => request.url.startsWith("/wrong/")));
    });
  });
}

test("HTML sitemap link lookup uses the document base resolved against the final homepage URL", async () => {
  await withServer((req, res) => {
    if (req.url === "/de") { res.writeHead(302, { Location: "/de/start/" }); res.end(); }
    else if (req.url === "/de/start/") res.end(`<html lang="de"><head><base href="../"></head><body>${germanText.repeat(4)}<a href="sitemap-custom.html">Seitenübersicht</a></body></html>`);
    else if (req.url === "/de/sitemap-custom.html") res.end(languageHtml("de", `Sitemap ${germanText.repeat(5)}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const result = await crawlSite(`${origin}/de`, 3);
    assert.equal(result.sitemapType, "html");
    assert.equal(result.htmlSitemapUrl, `${origin}/de/sitemap-custom.html`);
    assert.ok(requests.some(request => request.url === "/de/sitemap-custom.html"));
  });
});

test("fill seeds stay first, are not refetched, and excluded normalized links never return", async () => {
  await withServer(fillFixture, async ({ origin, requests }) => {
    const urls = [`${origin}/products/0`, `${origin}/services/0`];
    const selected = await fetchExplicitPages(origin, urls, seedOptions);
    assert.equal(requests.some(request => request.url === "/robots.txt"), false, "selection phase must not fetch technical files in fill mode");
    const result = await crawlSite(origin, 16, {
      seedPages: selected.pages, excludeUrls: [`${origin}/products/removed#ignored`], preferredLang: "de",
    });
    assert.deepEqual(result.pages.slice(0, 2).map(page => page.url), urls);
    assert.equal(requests.filter(request => request.url === "/products/0").length, 1);
    assert.equal(requests.filter(request => request.url === "/services/0").length, 1);
    assert.equal(requests.some(request => request.url === "/products/removed"), false);
    assert.equal(result.pages.some(page => page.url.includes("/products/removed")), false);
    assert.equal(result.pages.some(page => page.url === `${origin}/`), false, "discovery homepage is not evaluated");
    assert.equal(result.skipped.excludedPath, 1);
    assert.equal(result.pages.length, 16);
    assert.equal(requests.filter(request => request.url === "/robots.txt").length, 1);
    assert.equal(requests.filter(request => request.url === "/llms.txt").length, 1);
  });
});

test("a selected homepage is reused for discovery and counted only in the selection phase", async () => {
  await withServer(fillFixture, async ({ origin, requests }) => {
    const selected = await fetchExplicitPages(origin, [`${origin}/`], seedOptions);
    const result = await crawlSite(origin, 4, { seedPages: selected.pages, preferredLang: "de" });
    assert.equal(requests.filter(request => request.url === "/").length, 1);
    assert.equal(result.pages[0].url, `${origin}/`);
    assert.equal(result.pages.length, 4);
    assert.equal(result.reliability.attempted, 3);
    assert.equal(result.reliability.succeeded, 3);
  });
});

test("a discovery homepage redirect reuses its already selected destination", async () => {
  await withServer((req, res) => {
    if (req.url === "/") { res.writeHead(302, { Location: "/de/" }); res.end(); }
    else if (req.url === "/de/") res.end(languageHtml("de", `Root ${germanText.repeat(4)}`, ["/de/products/new"]));
    else if (req.url === "/de/products/new") res.end(languageHtml("de", `New ${germanText.repeat(4)}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const selected = await fetchExplicitPages(origin, [`${origin}/de/`], seedOptions);
    const result = await crawlSite(origin, 16, { seedPages: selected.pages, preferredLang: "de" });
    assert.equal(requests.filter(request => request.url === "/de/").length, 1);
    assert.deepEqual(result.pages.map(page => page.url), [`${origin}/de/`, `${origin}/de/products/new`]);
  });
});

test("seed links discover pages even when the unselected homepage contains no links", async () => {
  await withServer((req, res) => {
    if (["/", "/products/seed", "/services/seed-discovery"].includes(req.url)) {
      res.end(languageHtml("de", `${req.url} ${germanText.repeat(4)}`,
        req.url === "/products/seed" ? ["/services/seed-discovery"] : []));
    } else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const selected = await fetchExplicitPages(origin, [`${origin}/products/seed`], seedOptions);
    const result = await crawlSite(origin, 16, { seedPages: selected.pages, excludeUrls: [`${origin}/`], preferredLang: "de" });
    assert.deepEqual(result.pages.map(page => page.url), [`${origin}/products/seed`, `${origin}/services/seed-discovery`]);
    assert.equal(requests.filter(request => request.url === "/").length, 1, "excluded homepage is still fetched for discovery only");
    assert.equal(result.skipped.excludedPath, 1);
  });
});

test("German seeds on an English root fill German pages and reuse a seeded hreflang homepage", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(`<html lang="en"><head><link rel="alternate" hreflang="de" href="/de/"></head><body><main>${englishText.repeat(4)}</main></body></html>`);
    else if (req.url === "/de/") res.end(languageHtml("de", `German root ${germanText.repeat(4)}`, ["/de/products/new", "/en/products/new"]));
    else if (req.url.startsWith("/de/products/")) res.end(languageHtml("de", `${req.url} ${germanText.repeat(4)}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const selected = await fetchExplicitPages(origin, [`${origin}/de/`, `${origin}/de/products/seed`], seedOptions);
    const result = await crawlSite(origin, 16, { seedPages: selected.pages, preferredLang: "de" });
    assert.ok(result.pages.every(page => page.url.startsWith(`${origin}/de/`)));
    assert.ok(result.pages.some(page => page.url === `${origin}/de/products/new`));
    assert.equal(requests.filter(request => request.url === "/de/").length, 1);
    assert.equal(result.languageVariant.toLang, "de");
    assert.equal(result.reliability.succeeded, 2, "only original discovery homepage and new page belong to crawl-phase reliability");
  });
});

test("fill keeps selection language without hreflang and does not relax to English pages", async () => {
  await withServer((req, res) => {
    if (req.url === "/de/selected") res.end(languageHtml("de", germanText.repeat(4)));
    else if (req.url === "/" || req.url === "/products/english") res.end(languageHtml("en", `${req.url} ${englishText.repeat(4)}`, ["/products/english"]));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin }) => {
    const selected = await fetchExplicitPages(origin, [`${origin}/de/selected`], seedOptions);
    const result = await crawlSite(origin, 16, { seedPages: selected.pages, preferredLang: "de" });
    assert.deepEqual(result.pages.map(page => page.url), [`${origin}/de/selected`]);
    assert.equal(result.siteLanguage.lang, "de");
    assert.equal(result.skipped.otherLanguage, 1);
  });
});

test("page redirects cannot refetch seeded or deselected pages", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), ["/products/excluded-alias", "/services/seed-alias"]));
    else if (req.url === "/products/excluded-alias" || req.url === "/services/seed-alias") {
      res.writeHead(302, { Location: req.url.includes("excluded") ? "/products/excluded" : "/services/seed" }); res.end();
    } else if (req.url === "/services/seed") res.end(languageHtml("de", `Selected ${germanText.repeat(4)}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const selected = await fetchExplicitPages(origin, [`${origin}/services/seed`], seedOptions);
    const result = await crawlSite(origin, 16, { seedPages: selected.pages, excludeUrls: [`${origin}/products/excluded`], preferredLang: "de" });
    assert.equal(requests.some(request => request.url === "/products/excluded"), false);
    assert.equal(requests.filter(request => request.url === "/services/seed").length, 1);
    assert.deepEqual(result.pages.map(page => page.url), [`${origin}/services/seed`]);
  });
});

test("without seed or exclusion options the homepage remains evaluated", async () => {
  await withServer(fillFixture, async ({ origin }) => {
    const result = await crawlSite(origin, 1);
    assert.deepEqual(result.pages.map(page => page.url), [`${origin}/`]);
    assert.equal(result.reliability.succeeded, 1);
  });
});

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
  assert.match(source, /minTextChars:\s*50/);
  assert.match(source, /COMPETITOR_MAX_PAGES = 5/);
  assert.match(source, /CRAWL_DEADLINE_MS = 45_000/);
  assert.match(source, /techPhaseBudgetMs: 20_000/);
  assert.match(source, /minPagePhaseMs: 20_000/);
  const warning = source.slice(source.indexOf('if (crawlResult.timedOut'), source.indexOf('"Competitor crawl returned fewer pages than requested"'));
  assert.match(warning, /techPhaseMs: crawlResult\.techPhaseMs/);
  assert.match(warning, /pagePhaseMs: crawlResult\.pagePhaseMs/);
  const mainSource = await readFile(new URL("./analysis-engine.ts", import.meta.url), "utf8");
  assert.match(mainSource, /MAIN_TECH_PHASE_BUDGET_MS = 30_000/);
  assert.match(mainSource, /MAIN_MIN_PAGE_PHASE_MS = 45_000/);
  assert.equal((mainSource.match(/techPhaseBudgetMs: MAIN_TECH_PHASE_BUDGET_MS/g) ?? []).length, 2);
  assert.equal((mainSource.match(/minPagePhaseMs: MAIN_MIN_PAGE_PHASE_MS/g) ?? []).length, 2);
});

// Strong contrary-language fixtures must satisfy the 800-character threshold.
const germanText = "Wir bieten die Produkte und Leistungen für unsere Kunden an. Die Lösungen werden mit einer sicheren Technik auf den Bedarf unserer Kunden abgestimmt. ".repeat(2);
const englishText = "The products and services are designed for you and your team with our technology. We offer the solutions that you have been looking for with more information about our company. ".repeat(2);
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
    assert.equal(determined[0].obj.host, new URL(origin).hostname);
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
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "preferred", declared: "en", mismatch: true });
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
    // Only one contrary-language page fits beside the short homepage.
    // Fetches/duplicates outside the evaluated set cannot override the declaration.
    assert.deepEqual(capped.siteLanguage, { lang: "en", source: "declared", declared: "en", mismatch: false });
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
  assert.deepEqual(determineSiteLanguage([]), { lang: null, source: null, declared: null, mismatch: false });
  assert.deepEqual(determineSiteLanguage([en("de"), en("de")]), { lang: "en", source: "content", declared: "de", mismatch: true });
});

test("evaluated declarations use the first-five majority and the first evaluated page on ties", () => {
  const de = declared => ({ html: languageHtml(declared, germanText.repeat(4)) });
  assert.deepEqual(determineSiteLanguage(Array.from({ length: 5 }, () => de("de"))), { lang: "de", source: "content", declared: "de", mismatch: false });
  assert.deepEqual(determineSiteLanguage(Array.from({ length: 5 }, () => de("en"))), { lang: "de", source: "content", declared: "en", mismatch: true });
  assert.equal(determineSiteLanguage([de("en"), de("de"), de("de"), de(null), de("de")]).declared, "de");
  assert.equal(determineSiteLanguage([de("en"), de("de"), de("de"), de("en")]).declared, "en");
  assert.equal(determineSiteLanguage([de("de"), de("en"), de("en"), de("de")]).declared, "de");
  assert.equal(determineSiteLanguage([de(null), de("en"), de("de")]).declared, null);
  assert.equal(determineSiteLanguage(Array.from({ length: 5 }, () => de(null))).declared, null);
  assert.equal(determineSiteLanguage([de("en"), de("de"), de("de"), de("de"), de("de"), ...Array.from({ length: 6 }, () => de("en"))]).declared, "de");
});

function hardceramicHtml(suffix = "") {
  const teaser = englishText.repeat(2).slice(0, 350);
  return `<html lang="de-DE"><body><header>${englishText.repeat(20)}</header>
    <script>${englishText.repeat(20)}</script><div class="cookie-consent">${englishText.repeat(20)}</div>
    <article>${teaser}</article>${Array.from({ length: 6 }, (_, i) =>
      `<article>${germanText.repeat(3)} Artikel ${i} ${suffix}</article>`).join("")}
    <a href="/de/products/one">Produkt</a><a href="/de/products/two">Weitere Produkte</a>
    </body></html>`;
}
test("seven article homepage uses the cleaned German body rather than the first English teaser", () => {
  assert.deepEqual(detectPageLanguageDetailed(hardceramicHtml()), { lang: "de", source: "content", declared: "de" });
  assert.deepEqual(determineSiteLanguage([
    { html: hardceramicHtml() },
    { html: languageHtml("de", germanText.repeat(4)) },
  ]), { lang: "de", source: "content", declared: "de", mismatch: false });
});
test("one main or one article is preferred, while multiple main/article elements fall back to body", () => {
  const de = germanText.repeat(5), en = englishText.repeat(12);
  assert.equal(detectPageLanguage(`<html lang="de"><body>${en}<main>${de}</main></body></html>`), "de");
  assert.equal(detectPageLanguage(`<html lang="de"><body>${en}<article>${de}</article></body></html>`), "de");
  assert.equal(detectPageLanguage(`<html lang="de"><body><main>${englishText.slice(0, 300)}</main><main>${de}</main>${de}</body></html>`), "de");
});
test("content evidence honours 200/800 boundaries and short contradicting pages keep declarations", () => {
  for (const length of [199, 200, 300, 799, 800]) {
    const text = englishText.repeat(5).slice(0, length - 1) + ".";
    const contrary = detectPageLanguageDetailed(languageHtml("de", text));
    assert.deepEqual(contrary, length < 800
      ? { lang: "de", source: "declared", declared: "de" }
      : { lang: "en", source: "content", declared: "de" });
    for (const declaration of ["en", null]) {
      const agreeing = detectPageLanguageDetailed(languageHtml(declaration, text));
      assert.equal(agreeing.source, length < 200 ? declaration ? "declared" : null : "content");
      assert.equal(agreeing.lang, length < 200 && declaration === null ? null : "en");
    }
  }
  assert.deepEqual(determineSiteLanguage([{ html: languageHtml("de", englishText.slice(0, 299) + ".") }]),
    { lang: "de", source: "declared", declared: "de", mismatch: false });
});
test("site content overrides need two disagreeing evaluated pages, except for one long page", () => {
  const wrong = { html: languageHtml("en", germanText.repeat(4)) };
  const unknown = { html: languageHtml("en", "xyz ".repeat(210)) };
  assert.deepEqual(determineSiteLanguage([wrong]), { lang: "de", source: "content", declared: "en", mismatch: true });
  assert.deepEqual(determineSiteLanguage([wrong, unknown]), { lang: "en", source: "declared", declared: "en", mismatch: false });
  assert.deepEqual(determineSiteLanguage([wrong, wrong, unknown]), { lang: "de", source: "content", declared: "en", mismatch: true });
});
test("hardceramic-like crawl evaluates German subpages and preserves matching hreflang language", async () => {
  for (const start of ["/de/", "/"]) {
    await withServer((req, res) => {
      if (req.url === "/") res.end(languageHtml("en", englishText.repeat(4)) + '<link rel="alternate" hreflang="de" href="/de/">');
      else if (req.url === "/de/") res.end(hardceramicHtml());
      else if (req.url.startsWith("/de/products/")) res.end(languageHtml("de", `${germanText.repeat(4)} ${req.url}`));
      else { res.writeHead(404); res.end(); }
    }, async ({ origin }) => {
      const value = await crawlSite(`${origin}${start}`, 16);
      assert.equal(value.siteLanguage.lang, "de");
      assert.equal(value.siteLanguage.declared, "de");
      assert.equal(value.siteLanguage.mismatch, false);
      assert.equal(value.pages.length, 3);
      assert.equal(value.skipped.otherLanguage, 0);
      assert.equal(value.siteLanguage.source, start === "/" ? "hreflang" : "content");
    });
  }
});
test("matching declaration after a hreflang switch does not inherit the content detector mismatch", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("en", englishText.repeat(4)) + '<link rel="alternate" hreflang="de" href="/de/">');
    else if (req.url === "/de/") res.end(languageHtml("de-DE", englishText.repeat(4)));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin }) => {
    const value = await crawlSite(origin, 1);
    assert.deepEqual(value.siteLanguage, { lang: "de", source: "hreflang", declared: "de", mismatch: false });
  });
});
test("ordinary sc/mc/nxp/bom/faq/new paths are evaluated while real foreign language paths remain excluded", async () => {
  const paths = ["/sc/one", "/mc/two", "/nxp/three", "/bom-tool", "/faq/four", "/new/five", "/fr/produits"];
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), paths));
    else if (paths.includes(req.url)) res.end(languageHtml("de", `${germanText.repeat(4)} ${req.url}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const value = await crawlSite(origin, 16);
    assert.equal(value.pages.length, 7);
    assert.equal(value.skipped.otherLanguage, 1);
    assert.ok(!requests.some(req => req.url === "/fr/produits"));
    for (const pathname of paths.slice(0, -1)) assert.ok(value.pages.some(page => page.url === origin + pathname));
  });
});

test("explicit German pages ignore the English root declaration", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("en", englishText.repeat(4)));
    else if (req.url.startsWith("/de/page")) res.end(languageHtml("de", `${req.url} ${germanText.repeat(4)}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const result = await fetchExplicitPages(origin, Array.from({ length: 5 }, (_, index) => `${origin}/de/page${index}`));
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "content", declared: "de", mismatch: false });
    assert.ok(requests.some(request => request.url === "/"), "technical discovery still fetches the entered root");
  });
});

test("connection reset codes and socket messages are classified without changing existing mappings", () => {
  for (const code of ["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]) {
    assert.equal(classifyFetchError(Object.assign(new Error("failure"), { code })), "connection_reset");
    assert.equal(classifyFetchError(new Error("fetch failed", { cause: Object.assign(new Error("failure"), { code }) })), "connection_reset");
  }
  for (const message of ["other side closed", "socket hang up"]) {
    assert.equal(classifyFetchError(new Error(message)), "connection_reset");
    assert.equal(classifyFetchError(new Error("fetch failed", { cause: new Error(message) })), "connection_reset");
  }
  for (const [code, reason] of [
    ["ECONNREFUSED", "refused"], ["ENOTFOUND", "dns"], ["ETIMEDOUT", "timeout"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_chain"], ["CERT_HAS_EXPIRED", "tls_other"],
    ["REDIRECT_LOOP", "redirect_loop"], ["UNRECOGNIZED", "unknown"],
  ]) assert.equal(classifyFetchError({ cause: { code } }), reason);
  assert.equal(classifyFetchError(new Error("fetch-timeout")), "timeout");
});

for (const mode of ["explicit", "crawl", "homepage"]) {
  test(`${mode} page fetch retries one socket reset and counts a recovered page once`, async () => {
    let pageHits = 0;
    const path = mode === "homepage" ? "/" : "/de/produkte";
    await withServer((req, res) => {
      res.setHeader("Connection", "close");
      if (req.url === path) {
        if (++pageHits === 1) { req.socket.destroy(); return; }
        res.end(languageHtml("de", `Recovered ${germanText.repeat(4)}`));
      } else if (req.url === "/") res.end(languageHtml("de", `Root ${germanText.repeat(4)}`, [path]));
      else { res.writeHead(404); res.end(); }
    }, async ({ origin }) => {
      const result = mode === "explicit"
        ? await fetchExplicitPages(origin, [`${origin}${path}`], seedOptions)
        : await crawlSite(origin, mode === "homepage" ? 1 : 2);
      assert.equal(pageHits, 2);
      assert.ok(result.pages.some(page => new URL(page.url).href === new URL(`${origin}${path}`).href));
      assert.equal(result.reliability.attempted, mode === "crawl" ? 2 : 1);
      assert.equal(result.reliability.succeeded, result.reliability.attempted);
      assert.equal(result.reliability.failed, 0);
      assert.equal(logs.filter(log => log.msg === "Retrying page fetch" && new URL(log.obj.url).href === new URL(`${origin}${path}`).href).length, 1);
    });
  });
}

for (const mode of ["explicit", "crawl", "technical"]) {
  test(`${mode} persistent socket resets retain the classified failure and underlying cause code`, async () => {
    let pageHits = 0;
    await withServer((req, res) => {
      res.setHeader("Connection", "close");
      if (req.url === "/de/produkte") { pageHits++; req.socket.destroy(); }
      else if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), ["/de/produkte"]));
      else { res.writeHead(404); res.end(); }
    }, async ({ origin }) => {
      const result = mode === "explicit" ? await fetchExplicitPages(origin, [`${origin}/de/produkte`], seedOptions)
        : mode === "crawl" ? await crawlSite(origin, 2) : await fetchTechFile(`${origin}/de/produkte`, 1000);
      assert.equal(pageHits, 2);
      if (mode === "technical") assert.equal(result.reason, "connection_reset");
      else {
        assert.equal(result.reliability.failures[0].reason, "connection_reset");
        assert.equal(result.reliability.attempted, mode === "crawl" ? 2 : 1);
        assert.equal(result.reliability.failed, 1);
      }
      const failureLog = logs.find(log => log.level === "warn" && log.obj.reason === "connection_reset");
      assert.ok(failureLog);
      assert.match(failureLog.obj.cause.code, /^(ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED)$/);
      assert.equal(typeof failureLog.obj.cause.message, "string");
    });
  });
}

test("HTTP 404 and 500 page responses are not retried in explicit or automatic mode", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), ["/de/404", "/de/500"]));
    else { res.writeHead(req.url === "/de/500" ? 500 : 404); res.end(); }
  }, async ({ origin, requests }) => {
    await crawlSite(origin, 3);
    const explicit = await fetchExplicitPages(origin, [`${origin}/de/404`, `${origin}/de/500`], seedOptions);
    for (const path of ["/de/404", "/de/500"]) assert.equal(requests.filter(request => request.url === path).length, 2, "once per mode");
    assert.deepEqual(explicit.reliability.failures.map(failure => failure.reason), ["http_error", "http_error"]);
    assert.ok(!logs.some(log => log.msg === "Retrying page fetch"));
  });
});

test("HTML sitemap network failure includes its underlying cause in the technical-file log", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4)));
    else if (req.url === "/sitemap") req.socket.destroy();
    else { res.writeHead(404); res.end(); }
  }, async ({ origin }) => {
    const result = await crawlSite(origin, 1);
    assert.equal(result.sitemapStatus, "error");
    const entry = logs.find(log => log.msg === "technical file not retrieved" && log.obj.file === "Sitemap");
    assert.ok(entry);
    assert.match(entry.obj.cause.code, /^(ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED)$/);
    assert.equal(typeof entry.obj.cause.message, "string");
  });
});

test("ECONNREFUSED is classified and never retried for explicit pages", async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (url, options) => {
    assert.equal(new URL(url).origin, origin);
    calls++;
    return previousFetch(url, options);
  };
  try {
    const result = await fetchExplicitPages(origin, [`${origin}/de/produkte`], seedOptions);
    assert.equal(result.reliability.failures[0].reason, "refused");
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previousFetch; }
});

for (const mode of ["explicit", "crawl", "competitor"]) {
  test(`${mode} skips retry after its deadline is exhausted`, async () => {
    let pageHits = 0;
    await withServer((req, res) => {
      if (req.url === "/de/produkte") { pageHits++; req.socket.destroy(); }
      else if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), ["/de/produkte"]));
      else { res.writeHead(404); res.end(); }
    }, async ({ origin }) => {
      const realNow = Date.now;
      const localFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        try { return await localFetch(url, options); }
        catch (err) { Date.now = () => realNow() + 200_000; throw err; }
      };
      try {
        const result = mode === "explicit" ? await fetchExplicitPages(origin, [`${origin}/de/produkte`], seedOptions)
          : await crawlSite(origin, 2, mode === "competitor"
            ? { deadlineMs: 100, techPhaseBudgetMs: 50, minPagePhaseMs: 5000 } : { deadlineMs: 5000 });
        assert.equal(pageHits, 1);
        assert.equal(result.reliability.failures[0].reason, "connection_reset");
        assert.ok(!logs.some(log => log.msg === "Retrying page fetch"));
      } finally { Date.now = realNow; globalThis.fetch = localFetch; }
    });
  });
}

test("explicit fetch mode records site language but never filters selected pages", async () => {
  await withServer(languageSite(), async ({ origin }) => {
    const result = await fetchExplicitPages(origin, languagePaths.map(path => `${origin}${path}`));
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "content", declared: "en", mismatch: true });
    assert.equal(result.pages.length, 6);
    assert.deepEqual(result.pages.map(page => new URL(page.url).pathname), languagePaths);
    assert.equal(result.skipped.otherLanguage, 0);
  });
});

test("non-content detection distinguishes MIME types and image-only body text at the exact threshold", () => {
  const image = '<html><head><title>Image</title><meta name="robots" content="noindex"></head><body><script>Lots of invisible text</script><style>body { color: red }</style><noscript>Invisible fallback</noscript><img src="photo.jpg"></body></html>';
  for (const contentType of ["image/jpeg", "application/pdf", "text/plain"]) {
    assert.equal(isNonContentPage({ html: germanText.repeat(4), contentType }), "non_html");
  }
  for (const contentType of ["text/html", "application/xhtml+xml", null]) {
    assert.equal(isNonContentPage({ html: image, contentType }), "image_only");
    assert.equal(isNonContentPage({ html: '<body><img src="a">12345678901234567890</body>', contentType }), null);
    assert.equal(isNonContentPage({ html: "<body>Kurz</body>", contentType }), null);
  }
  assert.equal(isNonContentPage({ html: '<body><img src="a">1234567890123456789</body>', contentType: null }), "image_only");
});

test("thin-page detection uses the language detector's main text and removes boilerplate", () => {
  assert.equal(isThinPage(languageHtml("de", "x".repeat(49)), 50), true);
  assert.equal(isThinPage(languageHtml("de", "x".repeat(50)), 50), false);
  assert.equal(isThinPage(`<body><header>${germanText.repeat(5)}</header><nav>${englishText.repeat(5)}</nav><main>${"x".repeat(30)}<div class="cookie-banner">${germanText.repeat(5)}</div></main></body>`, 50), true);
  assert.equal(isThinPage(`<body><article>${"x".repeat(50)}</article></body>`, 50), false);
  assert.equal(isThinPage(`<body>${"x".repeat(50)}</body>`, 50), false);
});

test("fetchWithTiming returns normalized Content-Type from the final response, or null if absent", async () => {
  await withServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { Location: "/final", "Content-Type": "application/pdf" });
      res.end();
    } else if (req.url === "/final") {
      res.writeHead(200, { "Content-Type": "Text/HTML; charset=UTF-8" });
      res.end("<body>Final response</body>");
    } else {
      res.end("No Content-Type");
    }
  }, async ({ origin }) => {
    const result = await fetchWithTiming(`${origin}/start`);
    assert.equal(result.contentType, "text/html");
    assert.equal(result.finalUrl, `${origin}/final`);
    assert.equal((await fetchWithTiming(`${origin}/absent`)).contentType, null);
  });
});

const contentPaths = ["/products/popup", "/services/photo", "/news/document", "/company/thin"];
function contentSite(req, res) {
  if (req.url === "/") {
    res.end(languageHtml("de", germanText.repeat(4), contentPaths));
  } else if (req.url === contentPaths[0]) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<html><head><title>Image</title><meta name="robots" content="noindex"></head><body><img src="photo.jpg"></body></html>');
  } else if (req.url === contentPaths[1]) {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end("Synthetic image data");
  } else if (req.url === contentPaths[2]) {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end("%PDF synthetic file");
  } else if (req.url === contentPaths[3]) {
    res.end(languageHtml("de", "x".repeat(30)));
  } else {
    res.writeHead(404);
    res.end();
  }
}

test("automatic crawl counts image-only, extensionless image and PDF as successful fetches but not evaluated pages", async () => {
  await withServer(contentSite, async ({ origin }) => {
    const result = await crawlSite(origin, 16);
    assert.equal(result.reliability.succeeded, 5);
    assert.equal(result.reliability.failed, 0);
    assert.equal(result.pages.length, 2);
    assert.equal(result.skipped.nonContent, 3);
    assert.deepEqual(new Set(result.skipped.urls.map(url => new URL(url).pathname)), new Set(contentPaths.slice(0, 3)));
    assert.ok(result.pages.some(page => page.url.endsWith("/company/thin")), "main crawl has no thin-page rule");
  });
});

test("segment-anchored legal/account/widget and query exclusions are counted without fetching, while similarly named content stays", async () => {
  const excluded = [
    "/imprint", "/disclaimer", "/legal-notice", "/legal-information", "/data-protection", "/data-privacy",
    "/account", "/widget/x", "/widgets/x",
    "/action?eID=tx_cms_showpic&file=photo", "/action?add-to-cart=1", "/action?add_to_cart=1",
    "/action?add-to-quote=1", "/action?add-to-wishlist=1", "/action?fwp_x=1", "/action?fwp%5Fx=2",
  ];
  const kept = ["/accounting-software", "/imprinting-machines", "/widgetry", "/articles/imprint-history"];
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("de", germanText.repeat(4), [...excluded, ...kept]));
    else if (kept.includes(req.url)) res.end(languageHtml("de", `${germanText.repeat(3)} ${req.url}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin, requests }) => {
    const result = await crawlSite(origin, 16);
    assert.equal(result.skipped.excludedPath, excluded.length);
    assert.equal(result.skipped.nonContent, 0);
    assert.equal(result.pages.length, kept.length + 1);
    assert.ok(!requests.some(request => excluded.includes(request.url)));
    assert.ok(kept.every(path => result.pages.some(page => new URL(page.url).pathname === path)));
  });
});

test("minTextChars drops a 30-character subpage but never a short homepage; main crawl keeps that subpage", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(languageHtml("de", "Willkommen", ["/products/short", "/services/long"]));
    else if (req.url === "/products/short") res.end(languageHtml("de", "x".repeat(30)));
    else if (req.url === "/services/long") res.end(languageHtml("de", germanText.repeat(4)));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin }) => {
    const main = await crawlSite(origin, 16);
    assert.equal(main.pages.length, 3);
    assert.equal(main.skipped.nonContent, 0);
    const competitor = await crawlSite(origin, 5, { minTextChars: 50, preferredLang: "de" });
    assert.equal(competitor.pages.length, 2);
    assert.equal(competitor.reliability.succeeded, 3);
    assert.equal(competitor.skipped.nonContent, 1);
    assert.equal(competitor.pages[0].url, `${origin}/`);
  });
});

test("explicit mode drops non-content pages, keeps thin pages, preserves successful-fetch counts and logs language with host", async () => {
  await withServer(contentSite, async ({ origin }) => {
    const result = await fetchExplicitPages(origin, [`${origin}/`, ...contentPaths.map(path => `${origin}${path}`)]);
    assert.equal(result.pages.length, 2);
    assert.equal(result.reliability.succeeded, 5);
    assert.equal(result.reliability.failed, 0);
    assert.equal(result.skipped.nonContent, 3);
    assert.ok(result.pages.some(page => page.url.endsWith("/company/thin")));
    const determined = logs.filter(log => log.msg === "site language determined");
    assert.equal(determined.length, 1);
    assert.deepEqual(determined[0].obj, { host: "127.0.0.1", siteLanguage: result.siteLanguage, switched: false, readmittedPages: 0 });
    const firstExempt = await fetchExplicitPages(origin, [`${origin}${contentPaths[0]}`, `${origin}${contentPaths[3]}`]);
    assert.equal(firstExempt.pages.length, 2);
    assert.equal(firstExempt.skipped.nonContent, 0);
  });
});

test("automatic homepage remains exempt even when its response is image-only", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end('<body><img src="photo.jpg"></body>');
    else { res.writeHead(404); res.end(); }
  }, async ({ origin }) => {
    const result = await crawlSite(origin, 5, { minTextChars: 50 });
    assert.equal(result.pages.length, 1);
    assert.equal(result.skipped.nonContent, 0);
  });
});

test("competitor /de/ start path overrides requested English with source url", async () => {
  const paths = ["/de/products/one", "/de/services/two"];
  await withServer((req, res) => {
    if (req.url === "/de/") res.end(languageHtml("de", `${germanText.repeat(4)} Home`, paths));
    else if (paths.includes(req.url)) res.end(languageHtml("de", `${germanText.repeat(4)} ${req.url}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin }) => {
    const result = await crawlSite(`${origin}/de/`, 5, { preferredLang: "en", minTextChars: 50 });
    assert.equal(result.pages.length, 3);
    assert.equal(result.siteLanguage.lang, "de");
    assert.equal(result.siteLanguage.source, "url");
    const determined = logs.find(log => log.msg === "site language determined");
    assert.equal(determined.obj.requestedLang, "en");
    assert.equal(determined.obj.host, "127.0.0.1");
  });
});

test("competitor without a requested-language hreflang uses its own homepage content language", async () => {
  await withServer(languageSite({ declared: "de", longHomepage: true }), async ({ origin }) => {
    const result = await crawlSite(origin, 5, { preferredLang: "en", minTextChars: 50 });
    assert.equal(result.siteLanguage.lang, "de");
    assert.equal(result.siteLanguage.source, "content");
    assert.ok(result.pages.length >= 3);
    assert.equal(logs.find(log => log.msg === "site language determined").obj.requestedLang, "en");
  });
});

test("competitor with an English hreflang variant retains requested English and evaluates English subpages", async () => {
  const paths = ["/products/german", "/services/english", "/company/english-two"];
  await withServer((req, res) => {
    if (req.url === "/") res.end(`<html lang="de"><head><link rel="alternate" hreflang="en-US" href="/en/"></head><body><nav>${paths.map(path => `<a href="${path}">${path}</a>`).join("")}</nav><main>${germanText.repeat(4)} Home</main></body></html>`);
    else if (paths.includes(req.url)) res.end(languageHtml(req.url === paths[0] ? "de" : "en", `${(req.url === paths[0] ? germanText : englishText).repeat(4)} ${req.url}`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin }) => {
    const result = await crawlSite(origin, 5, { preferredLang: "en", minTextChars: 50 });
    assert.equal(result.siteLanguage.lang, "en");
    assert.equal(result.siteLanguage.source, "preferred");
    assert.equal(result.pages.length, 3);
    assert.equal(result.skipped.otherLanguage, 1);
    assert.ok(!result.pages.some(page => page.url.endsWith("/products/german")));
    assert.equal(logs.find(log => log.msg === "site language determined").obj.requestedLang, "en");
  });
});

function variantSite({ homeLang = "en", start = "/", variants = [{ lang: "de", url: "/de/" }], variantStatus = 200, variantDelay = 0, variantDeclared = "de", techDelay = 0 } = {}) {
  return async (req, res) => {
    if (req.url === "/robots.txt" || req.url === "/llms.txt") {
      if (techDelay) await delay(techDelay);
      res.end(req.url === "/robots.txt" ? "User-agent: *\nAllow: /" : "# Synthetic site information");
    } else if (req.url === start) {
      res.end(`<html lang="${homeLang}"><head>${variants.map(v => `<link rel="alternate" hreflang="${v.lang}" href="${v.url}">`).join("")}</head><body><nav><a href="${start === "/" ? "/english" : `${start}products/one`}">Content</a></nav><main>${(homeLang === "de" ? germanText : englishText).repeat(4)} Entry</main></body></html>`);
    } else if (/^\/de(?:-[a-z]+)?\/$/i.test(req.url)) {
      if (variantDelay) await delay(variantDelay);
      if (res.destroyed) return;
      res.writeHead(variantStatus, { "Content-Type": "text/html" });
      res.end(variantStatus === 200 ? languageHtml(variantDeclared, `${germanText.repeat(4)} German variant ${req.url}`, ["products/one", "services/two", "/english"]) : "Variant unavailable");
    } else if (/^\/de(?:-[a-z]+)?\/(?:products|services)\//i.test(req.url)) {
      res.end(languageHtml("de", `${germanText.repeat(4)} German content ${req.url}`));
    } else if (req.url === "/english" || req.url.startsWith("/en/products/")) {
      res.end(languageHtml("en", `${englishText.repeat(4)} English content ${req.url}`));
    } else if (req.url === "/sitemap.xml") {
      res.end(`<urlset><url><loc>http://${req.headers.host}/de/services/two</loc></url><url><loc>http://${req.headers.host}/english</loc></url></urlset>`);
    } else {
      res.writeHead(404);
      res.end();
    }
  };
}

for (const mode of ["main", "competitor"]) {
  for (const target of ["homepage", "language-variant homepage"]) {
    for (const scenario of ["502 then 200", "502 three times", "429 then 200"]) {
      test(`${mode} ${target}: ${scenario} checks normal HTTP responses before deciding the crawl outcome`, async () => {
        const variant = target === "language-variant homepage";
        const start = variant ? "/" : "/de";
        const retryPath = variant ? "/de/" : start;
        const persistent = scenario === "502 three times";
        const status = scenario.startsWith("429") ? 429 : 502;
        const site = variantSite();
        let hits = 0;
        await withServer((req, res) => {
          if (req.url === retryPath) {
            hits++;
            if (persistent || hits === 1) {
              res.writeHead(status, { "Content-Type": "text/html", ...(status === 429 ? { "Retry-After": "1" } : {}) });
              res.end("<html><body>Temporarily unavailable</body></html>");
              return;
            }
            if (!variant) {
              res.end(languageHtml("de", `${germanText.repeat(4)} Homepage`, ["/de/products/one"]));
              return;
            }
          }
          return site(req, res);
        }, async ({ origin, requests }) => {
          const result = await crawlSite(`${origin}${start}`, mode === "main" ? 16 : 5,
            mode === "main"
              ? { mainSite: true, deadlineMs: 90_000, techPhaseBudgetMs: 30_000, minPagePhaseMs: 45_000 }
              : { preferredLang: "de", minTextChars: 50, deadlineMs: 45_000, techPhaseBudgetMs: 20_000, minPagePhaseMs: 20_000 });
          assert.equal(hits, persistent ? 3 : 2);
          const retries = logs.filter(log => log.msg === "Retrying page fetch" && log.obj.url === `${origin}${retryPath}`);
          assert.equal(retries.length, persistent ? 2 : 1);
          assert.ok(retries.every(log => log.level === "debug" && log.obj.statusCode === status));
          assert.deepEqual(retries.map(log => log.obj.retries), persistent ? [1, 2] : [1]);
          assert.deepEqual(retries.map(log => log.obj.delayMs), persistent ? [2000, 4000] : [status === 429 ? 1000 : 2000]);
          assert.equal(result.reliability.transientErrors, 1);
          assert.equal(result.reliability.recoveredAfterRetry, persistent ? 0 : 1);
          const warnings = logs.filter(log => log.msg === "transient server errors");
          assert.equal(warnings.length, 1, "one aggregate WARN per crawl, including early homepage failures");
          assert.deepEqual(warnings[0], {
            level: "warn", msg: "transient server errors",
            obj: { transientErrors: 1, recoveredAfterRetry: persistent ? 0 : 1,
              attempted: result.reliability.attempted, byStatus: { [status]: 1 } },
          });
          if (!persistent) {
            assert.equal(result.homepageFailReason, null);
            assert.ok(result.pages.some(page => page.url === `${origin}${variant ? "/de" : start}`));
            assert.ok(result.pages.some(page => page.url === `${origin}/de/products/one`), "crawl continues to a subpage after homepage recovery");
            assert.equal(result.reliability.failed, 0);
            assert.equal(result.reliability.attempted, result.reliability.succeeded, "retries do not count as extra attempted pages");
            assert.equal(result.pages.find(page => page.url === `${origin}/de`).retries, 1);
            assert.ok(!logs.some(log => log.msg === "Homepage could not be analysed"));
            if (variant) assert.equal(result.languageVariant.toLang, "de");
          } else {
            const failure = result.reliability.failures.find(f => f.url === `${origin}${retryPath}`);
            assert.ok(failure);
            assert.equal(failure.statusCode, 502);
            assert.equal(failure.retries, 2);
            assert.equal(result.reliability.failed, 1, "exhausted retries count as one final failed page");
            assert.ok(!requests.some(req => req.url === "/de/products/one"));
            if (variant) {
              assert.equal(result.homepageFailReason, null);
              assert.equal(result.languageVariant, null);
              assert.ok(result.pages.some(page => page.url === `${origin}/`), "unavailable variant keeps the existing original-homepage fallback");
              assert.ok(logs.some(log => log.msg === "language variant unavailable" && log.obj.statusCode === 502));
            } else {
              assert.equal(result.homepageFailReason, "http_error");
              assert.equal(result.pages.length, 0);
              assert.equal(result.reliability.attempted, 1);
              assert.equal(result.reliability.succeeded, 0);
              assert.ok(logs.some(log => log.msg === "Homepage could not be analysed" && log.obj.statusCode === 502));
            }
          }
        });
      });
    }
  }
}

test("main crawl selects the same-site German variant in place, evaluates only its path and reuses robots/llms", async () => {
  await withServer(variantSite(), async ({ origin, requests }) => {
    const result = await crawlSite(`${origin}/`, 16);
    assert.deepEqual(result.languageVariant, { from: `${origin}/`, to: `${origin}/de/`, fromLang: "en", toLang: "de" });
    assert.deepEqual(result.siteLanguage, { lang: "de", source: "hreflang", declared: "de", mismatch: false });
    assert.equal(result.pages.length, 3);
    assert.ok(result.pages.every(page => /^\/de(?:\/|$)/.test(new URL(page.url).pathname)));
    assert.equal(result.reliability.succeeded, result.pages.length + 1, "the original homepage remains a successful fetch, not an evaluated page");
    for (const url of ["/robots.txt", "/llms.txt", "/sitemap.xml", "/", "/de/"]) {
      assert.equal(requests.filter(req => req.url === url).length, 1, url);
    }
    assert.ok(requests.findIndex(req => req.url === "/sitemap.xml") > requests.findIndex(req => req.url === "/de/"));
    assert.ok(!requests.some(req => req.url === "/english"));
    const selected = logs.findIndex(log => log.msg === "language variant selected");
    const determined = logs.findIndex(log => log.msg === "site language determined");
    assert.ok(selected >= 0 && determined > selected);
    assert.deepEqual(logs[selected].obj, { host: "127.0.0.1", ...result.languageVariant });
  });
});

test("an explicit English entry path is respected by main and competitor crawls", async () => {
  await withServer(variantSite({ start: "/en/" }), async ({ origin, requests }) => {
    for (const opts of [undefined, { preferredLang: "de", minTextChars: 50 }]) {
      const result = await crawlSite(`${origin}/en/`, 5, opts);
      assert.equal(result.languageVariant, null);
      assert.equal(result.siteLanguage.lang, "en");
      if (opts) assert.equal(result.siteLanguage.source, "url");
    }
    assert.ok(!requests.some(req => req.url === "/de/"));
    assert.ok(!logs.some(log => log.msg === "language variant selected"));
  });
});

test("a German main-site homepage never switches to its English hreflang variant", async () => {
  await withServer(variantSite({ homeLang: "de", variants: [{ lang: "en", url: "/en/" }] }), async ({ origin, requests }) => {
    const result = await crawlSite(origin, 5);
    assert.equal(result.languageVariant, null);
    assert.equal(result.siteLanguage.lang, "de");
    assert.ok(!requests.some(req => req.url === "/en/"));
  });
});

test("German variants on another host and x-default entries are ignored", async () => {
  for (const variants of [
    [{ lang: "de", url: "http://other.example/de/" }],
    [{ lang: "x-default", url: "/de/" }],
    [{ lang: "de", url: "/#same-homepage" }],
  ]) {
    await withServer(variantSite({ variants }), async ({ origin, requests }) => {
      const result = await crawlSite(origin, 5);
      assert.equal(result.languageVariant, null);
      assert.equal(result.siteLanguage.lang, "en");
      assert.ok(!requests.some(req => req.url === "/de/"));
    });
  }
});

test("unavailable German variants fall back to the original homepage and log a warning", async () => {
  for (const variantStatus of [404, 403]) {
    await withServer(variantSite({ variantStatus }), async ({ origin, requests }) => {
      const result = await crawlSite(origin, 5);
      assert.equal(result.languageVariant, null);
      assert.equal(result.siteLanguage.lang, "en");
      assert.equal(result.homepageFailReason, null);
      assert.ok(result.pages.some(page => page.url === `${origin}/`));
      assert.equal(requests.filter(req => req.url === "/").length, 1);
      assert.ok(logs.some(log => log.level === "warn" && log.msg === "language variant unavailable"));
      assert.ok(!logs.some(log => log.msg === "language variant selected"));
    });
  }
});

test("a competitor selects its chosen target-language variant without restarting technical fetches", async () => {
  await withServer(variantSite(), async ({ origin, requests }) => {
    const result = await crawlSite(origin, 5, { preferredLang: "de", minTextChars: 50, deadlineMs: 45000, techPhaseBudgetMs: 20000, minPagePhaseMs: 20000 });
    assert.equal(result.languageVariant.toLang, "de");
    assert.equal(result.siteLanguage.source, "hreflang");
    assert.equal(result.pages.length, 3);
    assert.equal(logs.find(log => log.msg === "site language determined").obj.requestedLang, "de");
    for (const url of ["/robots.txt", "/llms.txt"]) assert.equal(requests.filter(req => req.url === url).length, 1);
  });
});

test("a competitor can switch to English while main-site German preference remains unchanged", async () => {
  await withServer((req, res) => {
    if (req.url === "/") res.end(`<html lang="de"><head><link rel="alternate" hreflang="en" href="/en/"></head><body><main>${germanText.repeat(4)}</main></body></html>`);
    else if (req.url === "/en/") res.end(languageHtml("en", `${englishText.repeat(4)} English variant`, ["products/one"]));
    else if (req.url === "/en/products/one") res.end(languageHtml("en", `${englishText.repeat(4)} English product`));
    else { res.writeHead(404); res.end(); }
  }, async ({ origin }) => {
    const result = await crawlSite(origin, 5, { preferredLang: "en", minTextChars: 50 });
    assert.deepEqual(result.languageVariant, { from: `${origin}/`, to: `${origin}/en/`, fromLang: "de", toLang: "en" });
    assert.deepEqual(result.siteLanguage, { lang: "en", source: "hreflang", declared: "en", mismatch: false });
    assert.equal(result.pages.length, 2);
  });
});

test("variant ranking prefers de, then de-DE, then other regions; mismatch comes from the selected page", async () => {
  for (const [variants, expected] of [
    [[{ lang: "de-AT", url: "/de-at/" }, { lang: "de-DE", url: "/de-de/" }, { lang: "de", url: "/de/" }], "/de/"],
    [[{ lang: "de-AT", url: "/de-at/" }, { lang: "DE-de", url: "/de-de/" }], "/de-de/"],
    [[{ lang: "de-AT", url: "/de-at/" }], "/de-at/"],
  ]) {
    await withServer(variantSite({ variants, variantDeclared: "en" }), async ({ origin }) => {
      const result = await crawlSite(origin, 5);
      assert.equal(result.languageVariant.to, `${origin}${expected}`);
      assert.deepEqual(result.siteLanguage, { lang: "de", source: "hreflang", declared: "en", mismatch: true });
    });
  }
});

test("a slow variant fetch uses the original overall deadline, not a fresh crawl window", async () => {
  await withServer(variantSite({ variantDelay: 800 }), async ({ origin, requests }) => {
    const started = Date.now();
    const result = await crawlSite(origin, 5, { deadlineMs: 150 });
    assert.ok(Date.now() - started < 500, "variant fetch must abort within the original remaining budget");
    assert.equal(result.languageVariant, null);
    assert.equal(result.timedOut, true);
    assert.ok(result.pages.some(page => page.url === `${origin}/`));
    assert.ok(!requests.some(req => /\/products\/|\/services\//.test(req.url)));
    assert.ok(logs.some(log => log.msg === "language variant unavailable" && log.obj.reason === "timeout"));
  });
});

test("competitor technical budgets are not reset by a variant switch", async () => {
  await withServer(variantSite({ techDelay: 70, variantDelay: 60 }), async ({ origin, requests }) => {
    const result = await crawlSite(origin, 5, { preferredLang: "de", deadlineMs: 1000, techPhaseBudgetMs: 120, minPagePhaseMs: 100 });
    assert.equal(result.siteLanguage.source, "hreflang");
    assert.ok(result.techPhaseMs >= 200);
    assert.ok(!requests.some(req => req.url === "/sitemap.xml"));
    for (const url of ["/robots.txt", "/llms.txt"]) assert.equal(requests.filter(req => req.url === url).length, 1);
  });
});

test("explicitly selected pages never switch languages even when the homepage offers German", async () => {
  await withServer(variantSite(), async ({ origin, requests }) => {
    const result = await fetchExplicitPages(origin, [`${origin}/`, `${origin}/english`]);
    assert.equal(result.languageVariant, null);
    assert.ok(result.pages.every(page => !page.url.includes("/de")));
    assert.ok(!requests.some(req => req.url === "/de/"));
    assert.ok(!logs.some(log => log.msg === "language variant selected"));
  });
});
