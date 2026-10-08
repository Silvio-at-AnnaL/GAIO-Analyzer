import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./crawler": `
    export const crawlSite = async () => globalThis.__analysisLanguageTest?.crawlResult ?? {};
    export const fetchExplicitPages = async () => globalThis.__analysisLanguageTest?.crawlResult ?? {};
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
      warn() {},
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
  });
});

for (const mode of ["auto", "manual"]) {
  test(`${mode} result retains siteLanguage and passes its corrected language to competitors and recommendations`, async () => {
    const language = { lang: "de", source: "content", declared: "en", mismatch: true };
    const state = globalThis.__analysisLanguageTest = {
      language, competitorCalls: [],
      crawlResult: {
        siteLanguage: language,
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
  });
  assert.deepEqual(buildAnalysisInputs({}, []), {
    companyName: null,
    buyerPersonas: null,
    competitors: [],
    requestedPages: null,
    pageSelection: "auto",
  });
});