import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./crawler": `
    export const crawlSite = async (...args) => {
      const state = globalThis.__analysisLanguageTest;
      (state.crawlCalls ??= []).push(args);
      if (state.fillError) throw state.fillError;
      args[2]?.onHomepage?.(state.homepageHtml ?? "");
      return state.fillResult ?? state.crawlResult ?? {};
    };
    export const fetchExplicitPages = async (...args) => {
      const state = globalThis.__analysisLanguageTest;
      (state.explicitCalls ??= []).push(args);
      return state.selectedResult ?? state.crawlResult ?? {};
    };
    export const normalizeUrl = value => new URL(value).href.replace(/\\/$/, "");
    export const pageLanguage = () => "en";
    export const determineSiteLanguage = () => globalThis.__analysisLanguageTest?.language ?? { lang: null, source: null, declared: null, mismatch: false };
  `,
  "./analyzers/technical-seo": `export const analyzeTechnicalSeo = () => null;`,
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
      return [];
    };
  `,
  "./logger": `
    export const logger = {
      error() {},
      info() {},
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
  });
}