import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const mocks = {
  "../ai-client.js": `export async function callLLMDetailed(...args) {
    const state = globalThis.__competitorRetry;
    (state.calls ??= []).push(args);
    if (state.pending) return new Promise(() => {});
    if (state.response) return state.response;
    throw state.providerError ?? new Error("No AI in fixtures");
  }`,
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
  "../logger": `export const logger = Object.fromEntries(["info", "warn", "debug", "error"].map(level =>
    [level, (obj, msg) => (globalThis.__competitorRetry.logs ??= []).push({level, obj, msg})]));`,
};
const { outputFiles } = await build({
  stdin: {
    contents: readFileSync(new URL("./analyzers/competitors.ts", import.meta.url), "utf8")
      + "\nexport { generateFindings };",
    resolveDir: new URL("./analyzers/", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "competitor-reliability", setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
      ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
    b.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
  } }],
});
const { analyzeCompetitors, generateFindings, buildCompetitorFindingsFallback } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

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

const mainScores = {
  technicalScore: 70, schemaScore: 70, contentScore: 70,
  headingScore: 70, faqScore: 70, overallScore: 70,
};
const competitorScores = {
  technicalScore: 75, schemaScore: 50, contentScore: 60,
  headingScore: 50, faqScore: 50, compositeScore: 60,
};
const findings = {
  betterThanYou: "Stronger technical foundation",
  yourAdvantage: "More structured content",
  recommendation: "Improve technical accessibility",
};
const detailedResponse = (text, stopReason = "end_turn") => ({
  text, stopReason, inputTokens: 123, outputTokens: 45,
});
const requestFindings = () => generateFindings(
  "main.test", mainScores, "competitor.test", competitorScores, "Advantages", "Disadvantages",
);
const responseLogs = () => globalThis.__competitorRetry.logs.filter(
  log => log.msg === "Competitor findings response",
);
const fallbackWarnings = () => globalThis.__competitorRetry.logs.filter(
  log => log.level === "warn"
    && log.msg === "Failed to generate competitor findings — using deterministic fallback",
);

test("findings use the central client with exact options and log parsed metadata", async () => {
  globalThis.__competitorRetry = {
    response: detailedResponse(`Response:\n${JSON.stringify(findings)}\nEnd.`), logs: [],
  };
  assert.deepEqual(await requestFindings(), findings);
  assert.deepEqual(globalThis.__competitorRetry.calls, [[
    "", 1024, 0, { module: "competitor-findings", timeoutMs: 30_000, maxRetries: 0 },
  ]]);
  assert.equal(responseLogs().length, 1);
  const log = responseLogs()[0];
  assert.equal(log.level, "info");
  assert.equal(log.obj.competitorDomain, "competitor.test");
  assert.equal(log.obj.parsed, true);
  assert.equal(log.obj.stopReason, "end_turn");
  assert.equal(log.obj.inputTokens, 123);
  assert.equal(log.obj.outputTokens, 45);
  assert.equal(log.obj.maxTokens, 1024);
  assert.equal(log.obj.textChars, globalThis.__competitorRetry.response.text.length);
  assert.equal(fallbackWarnings().length, 0);
});

for (const [name, text, stopReason] of [
  ["invalid JSON", "{broken}", "end_turn"],
  ["invalid fields", JSON.stringify({ ...findings, recommendation: " " }), "end_turn"],
  ["truncated JSON", '{"betterThanYou":"Partial', "max_tokens"],
]) {
  test(`${name} returns deterministic fallback and preserves response metadata`, async () => {
    globalThis.__competitorRetry = { response: detailedResponse(text, stopReason), logs: [] };
    assert.deepEqual(await requestFindings(), buildCompetitorFindingsFallback(mainScores, competitorScores));
    assert.equal(responseLogs().length, 1);
    assert.equal(responseLogs()[0].obj.parsed, false);
    assert.equal(responseLogs()[0].obj.stopReason, stopReason);
    assert.equal(fallbackWarnings().length, 1);
    assert.equal(fallbackWarnings()[0].obj.stopReason, stopReason);
    assert.equal(fallbackWarnings()[0].obj.inputTokens, 123);
    assert.equal(fallbackWarnings()[0].obj.outputTokens, 45);
    assert.equal(fallbackWarnings()[0].obj.textStart, text.slice(0, 150));
    assert.equal(fallbackWarnings()[0].obj.textEnd, text.slice(-150));
  });
}

test("provider errors return deterministic fallback without claiming a response", async () => {
  globalThis.__competitorRetry = { providerError: new Error("Synthetic provider failure"), logs: [] };
  assert.deepEqual(await requestFindings(), buildCompetitorFindingsFallback(mainScores, competitorScores));
  assert.equal(responseLogs().length, 0);
  assert.equal(fallbackWarnings().length, 1);
  assert.equal(fallbackWarnings()[0].obj.reason, "Synthetic provider failure");
  assert.equal(fallbackWarnings()[0].obj.stopReason, null);
  assert.equal(fallbackWarnings()[0].obj.inputTokens, null);
  assert.equal(fallbackWarnings()[0].obj.textStart, null);
});

test("outer 30-second guard returns fallback and clears its timer when the provider never settles", async () => {
  globalThis.__competitorRetry = { pending: true, logs: [] };
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timer = {};
  let cleared = false;
  globalThis.setTimeout = (callback, delay) => {
    assert.equal(delay, 30_000);
    queueMicrotask(callback);
    return timer;
  };
  globalThis.clearTimeout = id => { assert.equal(id, timer); cleared = true; };
  try {
    assert.deepEqual(await requestFindings(), buildCompetitorFindingsFallback(mainScores, competitorScores));
    assert.equal(responseLogs().length, 0);
    assert.equal(fallbackWarnings().length, 1);
    assert.equal(fallbackWarnings()[0].obj.reason, "timeout");
    assert.equal(cleared, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
