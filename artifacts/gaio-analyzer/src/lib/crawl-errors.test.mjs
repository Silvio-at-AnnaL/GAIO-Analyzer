import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { outputFiles } = await build({
  stdin: {
    contents: `export { AnalysisErrors } from "../components/AnalysisErrors";
      export { AnalysisProgress } from "../components/AnalysisProgress";
      export { crawlFailureMessage, robotsHintText, readableAnalysisError } from "./crawl-errors";
      export { generateHtmlReport } from "./report-export";
      export { defaultTechnicalT } from "./technical-breakdown";
      export { labelDefaults } from "./labelDefaults";`,
    resolveDir: new URL(".", import.meta.url).pathname, loader: "tsx",
  },
  bundle: true, platform: "node", format: "esm", write: false,
  jsx: "automatic",
  define: { "import.meta.env.BASE_URL": '"/"' },
  plugins: [{
    name: "failure-render-test",
    setup(builder) {
      builder.onResolve({ filter: /^(react(?:-dom)?(?:\/.*)?|lucide-react)$/ }, args => ({
        path: import.meta.resolve(args.path), external: true,
      }));
      builder.onResolve({ filter: /LabelProvider$/ }, () => ({ path: "labels", namespace: "mock" }));
      builder.onResolve({ filter: /^@workspace\/api-client-react$/ }, () => ({ path: "api", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path === "labels"
        ? "export const useT = () => globalThis.__crawlErrorTestT;"
        : `export const useGetAnalysisReport = () => ({data: globalThis.__crawlErrorTestReport});
          export const getGetAnalysisReportQueryKey = () => ["test"];` }));
    },
  }],
});
const { AnalysisErrors, AnalysisProgress, crawlFailureMessage, robotsHintText, readableAnalysisError,
  generateHtmlReport, defaultTechnicalT: t, labelDefaults } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const codes = ["crawl_bot_protection", "crawl_parked_domain", "crawl_timed_out", "crawl_no_selected_page", "crawl_unreachable"];
const robots = { generalRule: "partial", fullyBlockedAgents: ["bingbot"],
  crawlers: [{ name: "GPTBot", status: "not_mentioned" }, { name: "ClaudeBot", status: "disallowed" }] };
function report(code) {
  return { id: "test", status: "failed", mode: "url", url: "https://example.test", progress: 5,
    errorCode: code, errors: ["Legacy German log sentence"], crawledPages: [], blockedRobotsHint: robots };
}
function render(Component, data, translate = t, extra = {}) {
  globalThis.__crawlErrorTestT = translate;
  globalThis.__crawlErrorTestReport = data;
  return renderToStaticMarkup(React.createElement(Component, { report: data, analysisId: "test", onComplete() {}, ...extra }));
}
async function htmlReport(data, translate = t) {
  const before = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try { return await generateHtmlReport(data, { t: translate }); }
  finally { globalThis.fetch = before; }
}

for (const code of codes) {
  test(`${code}: shared results renderer, progress and failed HTML report use translated title and paragraphs`, async () => {
    const custom = (key, vars) => key === `errors.${code}_title` ? "CUSTOM TITLE <safe>"
      : key === `errors.${code}_body` ? "CUSTOM FIRST\n\nCUSTOM SECOND" : t(key, vars);
    for (const html of [render(AnalysisErrors, report(code), custom),
      render(AnalysisProgress, report(code), custom), await htmlReport(report(code), custom)]) {
      assert.ok(html.includes("CUSTOM TITLE &lt;safe&gt;"));
      assert.match(html, /CUSTOM FIRST/);
      assert.match(html, /CUSTOM SECOND/);
      assert.ok(!html.includes("Legacy German log sentence"));
    }
    assert.equal(labelDefaults[`errors.${code}_title`].group, "errors");
    assert.equal(labelDefaults[`errors.${code}_body`].group, "errors");
  });
}

test("legacy prose without an errorCode is unchanged in results, progress and failed report", async () => {
  const legacy = report(undefined);
  for (const html of [render(AnalysisErrors, legacy), render(AnalysisProgress, legacy), await htmlReport(legacy)]) {
    assert.match(html, /Legacy German log sentence/);
    assert.ok(!html.includes(labelDefaults["errors.crawl_bot_protection_title"].de));
    assert.ok(!html.includes(labelDefaults["errors.robots_hint_title"].de));
  }
});

test("robots hint uses the approved German partial wording and explicit crawler status", async () => {
  const data = report("crawl_bot_protection");
  const hint = robotsHintText(data, t);
  assert.equal(hint.crawlers[0], "GPTBot: nicht erwähnt – es gilt die allgemeine Regel (erlaubt, einzelne Verzeichnisse ausgenommen)");
  assert.equal(hint.crawlers[1], "ClaudeBot: gesperrt");
  assert.equal(hint.fullyBlocked, "Vollständig gesperrt: bingbot");
  for (const html of [render(AnalysisErrors, data, t, { showRobotsHint: true }), await htmlReport(data)]) {
    assert.ok(html.includes(hint.crawlers[0]));
    assert.ok(html.includes(hint.fullyBlocked));
    assert.ok(html.includes(hint.note));
  }
  const allowed = { ...data, blockedRobotsHint: { ...robots, generalRule: "allowed" } };
  assert.equal(robotsHintText(allowed, t).crawlers[0], "GPTBot: nicht erwähnt – es gilt die allgemeine Regel (erlaubt)");
  assert.match(robotsHintText({ ...data, blockedRobotsHint: { ...robots, generalRule: "blocked" } }, t).crawlers[0], /\(gesperrt\)$/);
});

test("robots hints are absent without data or for any other error code, including export", async () => {
  for (const data of [report("crawl_unreachable"), { ...report("crawl_bot_protection"), blockedRobotsHint: undefined }]) {
    assert.equal(robotsHintText(data), null);
    for (const html of [render(AnalysisErrors, data, t, { showRobotsHint: true }), await htmlReport(data)]) {
      assert.ok(!html.includes(labelDefaults["errors.robots_hint_title"].de));
    }
  }
});

test("raw failure objects and serialized objects never appear in legacy error rendering", async () => {
  const failure = { url: "https://example.test/path", reason: "bot_protection", statusCode: 403 };
  for (const error of [failure, JSON.stringify(failure), [failure]]) {
    const data = { ...report(undefined), errors: [error] };
    for (const html of [render(AnalysisErrors, data), render(AnalysisProgress, data), await htmlReport(data)]) {
      assert.ok(!html.includes('"reason"') && !html.includes("&quot;reason&quot;"));
      assert.ok(!html.includes('"statusCode"') && !html.includes("[object Object]"));
    }
  }
  assert.equal(readableAnalysisError("Old German sentence", t), "Old German sentence");
  assert.ok(readableAnalysisError(failure, t).includes(t("results.crawl_reason_bot_protection")));
});

test("both results locations and legacy dashboard use the shared labelled renderer; shares embed generated HTML", async () => {
  const results = await readFile(new URL("../views/ErgebnisseView.tsx", import.meta.url), "utf8");
  assert.equal((results.match(/<AnalysisErrors report=\{report\} showRobotsHint/g) ?? []).length, 2);
  assert.ok(!results.includes("report.errors.map"));
  const legacy = await readFile(new URL("../components/ReportDashboard.tsx", import.meta.url), "utf8");
  assert.match(legacy, /<AnalysisErrors report=\{report\} showRobotsHint/);
  const shared = await readFile(new URL("../views/SharedAnalysisView.tsx", import.meta.url), "utf8");
  assert.match(shared, /srcDoc=\{data.htmlContent\}/);
  assert.ok(!shared.includes("JSON.stringify"));
  assert.equal(Object.keys(labelDefaults).length, 1307);
  assert.ok(crawlFailureMessage(report("crawl_timed_out")).paragraphs.length > 1);
});
