import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./crawler": `
    export const crawlSite = async () => ({});
    export const fetchExplicitPages = async () => ({});
    export const pageLanguage = () => "en";
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
  "./analyzers/competitors": `export const analyzeCompetitors = async () => null;`,
  "./analyzers/recommendations": `export const generateRecommendations = async () => [];`,
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
const { buildAnalysisInputs } = await import(
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