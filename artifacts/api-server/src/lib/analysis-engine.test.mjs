import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createServer } from "node:http";

const mocks = {
  "./crawler": `
    export const crawlSite = async (...args) => {
      const state = globalThis.__analysisLanguageTest;
      (state.crawlCalls ??= []).push(args);
      if (state.fillError) throw state.fillError;
      if (state.realCrawl) return state.realCrawl(...args);
      args[2]?.onHomepage?.(state.homepageHtml ?? "");
      return state.fillResult ?? state.crawlResult ?? {};
    };
    export const fetchExplicitPages = async (...args) => {
      const state = globalThis.__analysisLanguageTest;
      (state.explicitCalls ??= []).push(args);
      if (state.realSelection) return state.realSelection(...args);
      return state.selectedResult ?? state.crawlResult ?? {};
    };
    export const fetchSiteTechFiles = async (...args) => {
      const state = globalThis.__analysisLanguageTest;
      (state.techCalls ??= []).push(args);
      if (state.techError) throw state.techError;
      if (state.realTechFiles) return state.realTechFiles(...args);
      return state.techResult ?? {
        robotsTxt: "Recovered robots", robotsTxtExists: true, robotsTxtStatus: "found",
        sitemapXml: "<urlset/>", sitemapXmlExists: true, sitemapStatus: "found",
        llmsTxt: "Recovered llms", llmsTxtExists: true, llmsTxtStatus: "found",
      };
    };
    export const normalizeUrl = value => new URL(value).href.replace(/\\/$/, "");
    export const pageLanguage = () => "en";
    export const determineSiteLanguage = () => globalThis.__analysisLanguageTest?.language ?? { lang: null, source: null, declared: null, mismatch: false };
  `,
  "./analyzers/technical-seo": `export const analyzeTechnicalSeo = (...args) => {
    const state = globalThis.__analysisLanguageTest;
    state.technicalCrawl = args[0];
    return state.realTechnicalSeo ? state.realTechnicalSeo(...args) : null;
  };`,
  "./analyzers/schema-org": `export const analyzeSchemaOrg = () => null;`,
  "./analyzers/headings": `export const analyzeHeadings = () => null;`,
  "./analyzers/content-relevance": `
    export const analyzeContentRelevance = async () => null;
    export const usableContentRelevance = (value) => value;
  `,
  "./analyzers/faq": `export const analyzeFaq = async () => null;`,
  "./analyzers/llm-discoverability": `export const analyzeLlmDiscoverability = async () => null;`,
  "./analyzers/competitors": `
    export const analyzeCompetitors = async (...args) => {
      globalThis.__analysisLanguageTest.competitorCalls.push(args);
      return null;
    };
  `,
  "./analyzers/recommendations": `
    export const generateRecommendations = async (modules) => {
      globalThis.__analysisLanguageTest.modules = modules;
      if (globalThis.__analysisLanguageTest.realRules) return globalThis.__analysisLanguageTest.realRules(modules);
      return [];
    };
  `,
  "./logger": `
    export const logger = {
      error() {},
      info() {},
      debug() {},
      warn(obj, msg) { (globalThis.__analysisLanguageTest.warnings ??= []).push({ obj, msg }); },
    };
  `,
  "./admin-db.js": `
    export const createAnalysisLog = async () => null;
    export const updateAnalysisLogComplete = async () => {};
    export const updateAnalysisLogFailed = async () => {};
  `,
  "./score-config.js": `export const getScoreParams = async () => ({});`,
  "./log-context.js": `export const runWithAnalysisContext = (_id, callback) => callback();`,
};

const { outputFiles } = await build({
  entryPoints: [new URL("./analysis-engine.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "analysis-engine-test-mocks",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => (
        Object.hasOwn(mocks, args.path)
          ? { path: args.path, namespace: "analysis-engine-test" }
          : undefined
      ));
      builder.onLoad({ filter: /.*/, namespace: "analysis-engine-test" }, (args) => ({
        contents: mocks[args.path],
        loader: "js",
      }));
    },
  }],
});
const { buildAnalysisInputs, runAnalysis, getAnalysis } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`,
);

test("normalizes empty company name and buyer personas to null", () => {
  assert.deepEqual(buildAnalysisInputs({
    companyName: " \t ",
    buyerPersonas: "\n ",
  }), {
    companyName: null,
    buyerPersonas: null,
    competitors: [],
    requestedPages: null,
    pageSelection: "auto",
    excludedPages: null,
    autoAddedPages: [],
  });
});

for (const mode of ["auto", "manual"]) {
  test(`${mode} result retains siteLanguage and passes its corrected language to competitors and recommendations`, async () => {
    const language = { lang: "de", source: mode === "auto" ? "hreflang" : "content", declared: "en", mismatch: true };
    const languageVariant = mode === "auto" ? { from: "http://127.0.0.1/home", to: "http://127.0.0.1/de/", fromLang: "en", toLang: "de" } : null;
    const state = globalThis.__analysisLanguageTest = {
      language, competitorCalls: [],
      crawlResult: {
        siteLanguage: language,
        languageVariant,
        pages: [{ url: "http://127.0.0.1/home", html: '<html lang="en"><body>Kurz</body></html>', statusCode: 200 }],
        reliability: { attempted: 1, succeeded: 1, failed: 0, failures: [] },
        skipped: { otherLanguage: 0, excludedPath: 0, duplicate: 0, nonContent: mode === "manual" ? 1 : 0, urls: [] },
      },
    };
    await runAnalysis(`synthetic-language-${mode}`, "url", "http://127.0.0.1/home", null,
      { competitors: "http://localhost/rival" }, mode === "manual" ? ["http://127.0.0.1/home"] : null);
    const result = getAnalysis(`synthetic-language-${mode}`);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.siteLanguage, language);
    assert.deepEqual(result.languageVariant, languageVariant);
    assert.equal(result.url, "http://127.0.0.1/home", "the entered URL must remain unchanged");
    assert.deepEqual(result.crawlSkipped, state.crawlResult.skipped);
    assert.equal(state.competitorCalls.length, 1);
    assert.equal(state.competitorCalls[0][3], "de", "must not use the homepage declaration");
    assert.deepEqual(state.modules.siteLanguage, language);
  });
}

test("splits competitor lines, trims values, and drops blank lines without reordering", () => {
  assert.deepEqual(buildAnalysisInputs({
    competitors: "  https://one.example  \n\n second.example \r\n   \nthird.example",
  }).competitors, [
    "https://one.example",
    "second.example",
    "third.example",
  ]);
});

test("preserves explicit URL order and selects manual versus auto pages", () => {
  const explicitUrls = [
    "https://example.test/second",
    "https://example.test/first",
  ];
  assert.deepEqual(buildAnalysisInputs(null, explicitUrls), {
    companyName: null,
    buyerPersonas: null,
    competitors: [],
    requestedPages: explicitUrls,
    pageSelection: "manual",
    excludedPages: null,
    autoAddedPages: [],
  });
  assert.deepEqual(buildAnalysisInputs({}, []), {
    companyName: null,
    buyerPersonas: null,
    competitors: [],
    requestedPages: null,
    pageSelection: "auto",
    excludedPages: null,
    autoAddedPages: [],
  });
});

const selectedPage = { url: "http://127.0.0.1/de/selected", html: "<html lang='de'><body>Auswahl</body></html>", statusCode: 200 };
function mixedState() {
  return globalThis.__analysisLanguageTest = {
    language: { lang: "de", source: "content", declared: "en", mismatch: true },
    competitorCalls: [],
    selectedResult: {
      pages: [selectedPage],
      languageVariant: null,
      reliability: { attempted: 2, succeeded: 2, failed: 0, failures: [] },
      skipped: { otherLanguage: 0, excludedPath: 0, duplicate: 0, nonContent: 1, urls: ["http://127.0.0.1/image"] },
    },
    fillResult: {
      pages: [selectedPage, { ...selectedPage, url: "http://127.0.0.1/de/added" }],
      languageVariant: { from: "http://127.0.0.1/", to: "http://127.0.0.1/de/", fromLang: "en", toLang: "de" },
      robotsTxt: "Crawl phase robots", llmsTxt: "Crawl phase llms", sitemapXml: "<urlset/>",
      reliability: { attempted: 3, succeeded: 2, failed: 1, failures: [{ url: "http://127.0.0.1/fail", reason: "http_error" }] },
      skipped: { otherLanguage: 1, excludedPath: 2, duplicate: 0, nonContent: 0, urls: ["http://127.0.0.1/excluded"] },
    },
  };
}

test("mixed inputs keep the requested selection and exclusions without enabling mixed for empty selection", () => {
  const inputs = buildAnalysisInputs(null, [selectedPage.url], { fillToMax: true, excludedUrls: ["http://127.0.0.1/excluded"] });
  assert.equal(inputs.pageSelection, "mixed");
  assert.deepEqual(inputs.requestedPages, [selectedPage.url]);
  assert.deepEqual(inputs.excludedPages, ["http://127.0.0.1/excluded"]);
  assert.deepEqual(inputs.autoAddedPages, []);
  assert.equal(buildAnalysisInputs(null, [], { fillToMax: true }).pageSelection, "auto");
});

test("mixed analysis merges both phases and exposes only newly evaluated URLs as automatic additions", async () => {
  const state = mixedState();
  await runAnalysis("synthetic-mixed", "url", "http://127.0.0.1/", null, null,
    [selectedPage.url, "http://127.0.0.1/image"], null, { fillToMax: true, excludedUrls: ["http://127.0.0.1/excluded"] });
  const result = getAnalysis("synthetic-mixed");
  assert.equal(result.status, "completed");
  assert.equal(result.inputs.pageSelection, "mixed");
  assert.deepEqual(result.inputs.requestedPages, [selectedPage.url, "http://127.0.0.1/image"]);
  assert.deepEqual(result.inputs.excludedPages, ["http://127.0.0.1/excluded"]);
  assert.deepEqual(result.inputs.autoAddedPages, ["http://127.0.0.1/de/added"]);
  assert.deepEqual(result.crawlReliability, { attempted: 5, succeeded: 4, failed: 1, failures: state.fillResult.reliability.failures });
  assert.equal(result.crawlSkipped.nonContent, 1);
  assert.equal(result.crawlSkipped.excludedPath, 2);
  assert.deepEqual(result.languageVariant, state.fillResult.languageVariant);
  assert.equal(state.explicitCalls[0][2].skipTechFiles, true);
  assert.equal(state.crawlCalls[0][1], 16);
  assert.equal(state.crawlCalls[0][2].preferredLang, "de");
  assert.deepEqual(state.crawlCalls[0][2].seedPages, [selectedPage]);
  assert.equal(state.techCalls, undefined, "successful fill must not refetch technical files");
});

for (const failure of ["throw", "homepage"]) {
  test(`fill failure (${failure}) retains evaluated selection, mixed inputs and no automatic additions`, async () => {
    const state = mixedState();
    if (failure === "throw") state.fillError = new Error("Synthetic crawl failure");
    else state.fillResult.homepageFailReason = "bot_protection";
    await runAnalysis(`synthetic-fill-failure-${failure}`, "url", "http://127.0.0.1/", null, null,
      [selectedPage.url], null, { fillToMax: true });
    const result = getAnalysis(`synthetic-fill-failure-${failure}`);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.crawledPages, [selectedPage.url]);
    assert.equal(result.inputs.pageSelection, "mixed");
    assert.deepEqual(result.inputs.autoAddedPages, []);
    assert.ok(state.warnings.some(entry => entry.msg === "page fill failed"));
    assert.equal(state.techCalls.length, 1);
    assert.equal(state.technicalCrawl.robotsTxt, "Recovered robots");
    assert.equal(state.technicalCrawl.sitemapStatus, "found");
    assert.equal(state.technicalCrawl.llmsTxt, "Recovered llms");
  });
  test(`fill failure (${failure}) with a failed technical recovery reports error, not missing`, async () => {
    const state = mixedState();
    if (failure === "throw") state.fillError = new Error("Synthetic fill failure");
    else state.fillResult.homepageFailReason = "bot_protection";
    state.techError = new Error("Synthetic technical recovery failure");
    const id = `synthetic-tech-failure-${failure}`;
    await runAnalysis(id, "url", "http://127.0.0.1/", null, null, [selectedPage.url], null, { fillToMax: true });
    assert.equal(getAnalysis(id).status, "completed");
    assert.deepEqual(getAnalysis(id).crawledPages, [selectedPage.url]);
    for (const key of ["robotsTxtStatus", "sitemapStatus", "llmsTxtStatus"]) {
      assert.equal(state.technicalCrawl[key], "error");
    }
    assert.equal(state.techCalls.length, 1);
  });
}

// Real HTTP crawling/technical files and rule-based analysis; AI and DB remain stubbed.
const helperBundle = await build({
  stdin: {
    contents: `
      export { crawlSite, fetchExplicitPages, fetchSiteTechFiles } from "./crawler.ts";
      export { analyzeTechnicalSeo } from "./analyzers/technical-seo.ts";
      export { generateRuleBasedRecommendations } from "./analyzers/recommendations.ts";
    `,
    resolveDir: new URL(".", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "local-fill-helpers",
    setup(builder) {
      const helperMocks = {
        "./logger": mocks["./logger"],
        "../logger": mocks["./logger"],
        "@workspace/integrations-anthropic-ai": "export const anthropic = {};",
        "../prompt-manager.js": "export const getPrompt = async () => ''; export const fillTemplate = () => '';",
        "./recommendation-input.js": "export const buildRecommendationInput = () => ({});",
      };
      builder.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(helperMocks, args.path)
        ? { path: args.path, namespace: "fill-helper" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fill-helper" }, args => ({
        contents: helperMocks[args.path], loader: "js",
      }));
    },
  }],
});
const realHelpers = await import(`data:text/javascript;base64,${Buffer.from(helperBundle.outputFiles[0].contents).toString("base64")}`);

for (const failure of ["throw", "homepage"]) {
  test(`local HTTP fill failure (${failure}) recovers technical files and prevents false missing-robots recommendations`, async () => {
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      if (req.url === "/robots.txt") res.end(`User-agent: *\nAllow: /\nSitemap: http://${req.headers.host}/sitemap.xml`);
      else if (req.url === "/llms.txt") res.end("# Synthetic German product documentation");
      else if (req.url === "/sitemap.xml") res.end("<urlset></urlset>");
      else if (req.url === "/de/selected" || (req.url === "/" && failure === "throw")) {
        res.end(`<html lang="de"><head><title>Produktinformationen</title></head><body><main>${"Die Produkte und die Informationen für unsere Kunden sind für die Anwendung wichtig. ".repeat(10)}</main></body></html>`);
      } else { res.writeHead(req.url === "/" ? 403 : 404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    const originalFetch = globalThis.fetch;
    // Preserve existing portless robots/llms construction while prohibiting external requests.
    globalThis.fetch = (url, options) => {
      const target = new URL(url);
      assert.equal(target.hostname, "127.0.0.1");
      if (!target.port) target.port = String(port);
      assert.equal(target.port, String(port));
      return originalFetch(target, options);
    };
    try {
      const state = mixedState();
      state.realSelection = realHelpers.fetchExplicitPages;
      state.realTechFiles = realHelpers.fetchSiteTechFiles;
      state.realCrawl = realHelpers.crawlSite;
      state.realTechnicalSeo = realHelpers.analyzeTechnicalSeo;
      state.realRules = realHelpers.generateRuleBasedRecommendations;
      if (failure === "throw") state.fillError = new Error("Injected fill failure");
      const id = `local-http-fill-${failure}`;
      await runAnalysis(id, "url", origin, null, null, [`${origin}/de/selected`], null, { fillToMax: true });
      const result = getAnalysis(id);
      assert.equal(result.status, "completed");
      assert.deepEqual(result.crawledPages, [`${origin}/de/selected`]);
      assert.equal(result.inputs.pageSelection, "mixed");
      assert.deepEqual(result.inputs.autoAddedPages, []);
      for (const key of ["robotsTxtStatus", "sitemapStatus", "llmsTxtStatus"]) assert.equal(state.technicalCrawl[key], "found");
      assert.match(state.technicalCrawl.robotsTxt, /User-agent/);
      assert.match(state.technicalCrawl.sitemapXml, /urlset/);
      assert.match(state.technicalCrawl.llmsTxt, /documentation/);
      assert.equal(state.techCalls.length, 1);
      assert.ok(requests.includes("/robots.txt") && requests.includes("/sitemap.xml") && requests.includes("/llms.txt"));
      assert.ok(!result.recommendations.some(rec => rec.finding === "robots.txt fehlt vollständig"));
    } finally {
      globalThis.fetch = originalFetch;
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}