import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "@workspace/integrations-anthropic-ai": `export const anthropic = { messages: { create: async () => { throw new Error("No AI in fixtures"); } } };`,
  "../crawler": `export const crawlSite = async () => globalThis.__competitorRetry.crawl;`,
  "./technical-seo": `export const analyzeTechnicalSeo = (crawl, url, params) => {
    globalThis.__competitorRetry.technical = { crawl, params }; return {score: 75};
  };`,
  "./schema-org": `export const analyzeSchemaOrg = () => ({score: 50});`,
  "./headings": `export const analyzeHeadings = () => ({score: 50});`,
  "./faq": `export const analyzeFaq = async () => ({score: 50});`,
  "./content-relevance": `export const extractPageText = html => html;
    export const analyzeContentRelevance = async () => ({score: 50});`,
  "../prompt-manager.js": `export const getPrompt = async () => "";
    export const fillTemplate = () => "";`,
  "../score-config.js": `export const getScoreParams = async slug => slug === "technical" ? {retry_credit: 0.25} : {};`,
  "../logger": `export const logger = {info(){}, warn(){}, debug(){}, error(){}};`,
};
const { outputFiles } = await build({
  entryPoints: [new URL("./analyzers/competitors.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "competitor-reliability", setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
      ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
    b.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
  } }],
});
const { analyzeCompetitors } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

for (const outcome of ["evaluated", "unreachable", "js_rendered"]) {
  test(`competitor ${outcome} retains optional retry reliability in the analysis result`, async () => {
    const reliability = { attempted: 2, succeeded: outcome === "unreachable" ? 0 : 2,
      failed: outcome === "unreachable" ? 2 : 0, failures: [], transientErrors: 2,
      recoveredAfterRetry: outcome === "unreachable" ? 0 : 2 };
    const crawl = {
      pages: outcome === "unreachable" ? [] : [{ url: "https://competitor.test/de",
        html: outcome === "js_rendered" ? "<html/>" : `<html><body>${"Inhalte Produkte ".repeat(80)}</body></html>` }],
      reliability, skipped: {}, homepageFailReason: outcome === "unreachable" ? "http_error" : null,
    };
    globalThis.__competitorRetry = { crawl };
    const result = await analyzeCompetitors(["https://competitor.test/de"], {
      technicalScore: 70, schemaScore: 70, contentScore: 70, headingScore: 70, faqScore: 70, overallScore: 70,
    }, "", "de", { isExcluded: () => false, countsInReport: () => false });
    const competitor = result.competitors[0];
    assert.deepEqual(competitor.crawlReliability, reliability);
    if (outcome === "evaluated") {
      assert.equal(competitor.technicalScore, 75);
      assert.equal(globalThis.__competitorRetry.technical.params.retry_credit, 0.25);
      assert.deepEqual(globalThis.__competitorRetry.technical.crawl.reliability, reliability);
    } else assert.equal(competitor.errorReason, outcome);
  });
}
