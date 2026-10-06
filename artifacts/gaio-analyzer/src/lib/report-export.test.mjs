import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

async function load(entry) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", write: false,
    define: { "import.meta.env.BASE_URL": '"/"' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}
const { generateHtmlReport } = await load("./report-export.ts");
const { parseReportSetup } = await load("./report-setup.ts");
const { buildReportInputParams } = await load("./report-input-params.ts");
const { customFetch } = await load("../../../../lib/api-client-react/src/custom-fetch.ts");

const form = {
  companyName: " Browser Company ",
  personas: " Browser Persona ",
  competitors: [" https://browser.example.test ", " "],
};
const report = {
  id: "synthetic-analysis",
  mode: "url",
  status: "completed",
  url: "https://example.test",
  overallScore: 55,
  crawledPages: ["https://example.test/z", "https://example.test/a", "https://example.test/m"],
  inputs: {
    companyName: "Example Instruments",
    buyerPersonas: "Engineers </script><b>&",
    competitors: ["https://rival.example.test", "https://other.example.test"],
    requestedPages: ["https://example.test/a", "https://example.test/missing"],
    pageSelection: "manual",
  },
};
async function exportReport(value, inputParams = buildReportInputParams(value, form, "01.10.2026")) {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    return await generateHtmlReport(value, { inputParams });
  } finally {
    globalThis.fetch = fetchBefore;
  }
}
function block(html) {
  const text = html.match(/<script type="application\/json" id="gaio-analysis-data">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(text);
  assert.ok(!text.includes("<"));
  return JSON.parse(text);
}

test("real HTML export round-trips the server setup safely and keeps existing block keys", async () => {
  const html = await exportReport(report);
  const data = block(html);
  const result = parseReportSetup(html);
  assert.equal(result.ok, true);
  assert.equal(result.source, "block-v2");
  assert.deepEqual(result.setup, {
    url: report.url,
    companyName: report.inputs.companyName,
    persona: report.inputs.buyerPersonas,
    competitors: report.inputs.competitors,
    pages: report.crawledPages,
    requestedPages: report.inputs.requestedPages,
    pageSelection: "manual",
    analysisId: report.id,
    exportDate: data.exportDate,
  });
  assert.deepEqual(result.warnings, ["requested_pages_not_analyzed"]);
  assert.equal(data.blockVersion, 2);
  assert.equal(data.status, "completed");
  assert.equal(data.inputsSource, "server");
  assert.equal(data.mode, "url");
  assert.equal(data.domain, report.url);
  assert.equal(data.companyName, report.inputs.companyName);
  assert.equal(data.gaioScore, 55);
  assert.deepEqual(data.scores, {
    technical: null, schema: null, headings: null, content: null, faq: null, llm: null,
  });
  assert.equal(new Date(data.exportDate).toISOString(), data.exportDate);
  assert.ok(html.includes("Engineers &lt;/script&gt;&lt;b&gt;&amp;"));
  assert.ok(!html.includes("Browser Company"));
  console.log("V2 round-trip block:\n" + JSON.stringify(data, null, 2));
});

test("redirect_loop has the same German label in results and HTML export renderers", async () => {
  const { labelDefaults } = await load("./labelDefaults.ts");
  assert.deepEqual(labelDefaults["results.crawl_reason_redirect_loop"], {
    group: "results", de: "Weiterleitungsschleife",
  });
  const resultsSource = await readFile(new URL("../views/ErgebnisseView.tsx", import.meta.url), "utf8");
  assert.match(resultsSource, /redirect_loop:\s*"results\.crawl_reason_redirect_loop"/);
  const html = await exportReport({
    ...report,
    crawlReliability: {
      attempted: 2, succeeded: 1, failed: 1,
      failures: [{ url: "https://example.test/redirect-loop", reason: "redirect_loop" }],
    },
  });
  assert.match(html, /Weiterleitungsschleife/);
  assert.match(html, /https:\/\/example\.test\/redirect-loop/);
});

test("shared helper prefers validated inputs, including nulls, and preserves old form fallback", () => {
  const server = buildReportInputParams(report, form, "test-date");
  assert.equal(server.companyName, "Example Instruments");
  assert.equal(server.targetAudience, "Engineers </script><b>&");
  assert.equal(server.domainUrl, report.url);
  assert.equal(server.crawledPagesCount, 3);
  assert.equal(server.analysisDate, "test-date");
  for (const inputs of [undefined, null, {}, { ...report.inputs, competitors: [123] }]) {
    const fallback = buildReportInputParams({ ...report, inputs }, form, "test-date");
    assert.equal(fallback.inputsSource, "form");
    assert.equal(fallback.companyName, "Browser Company");
    assert.equal(fallback.targetAudience, "Browser Persona");
    assert.deepEqual(fallback.competitors, [" https://browser.example.test "]);
    assert.equal(fallback.requestedPages, null);
    assert.equal(fallback.pageSelection, null);
  }
  const empty = buildReportInputParams({
    ...report, inputs: { ...report.inputs, companyName: null, buyerPersonas: null, competitors: [] },
  }, form);
  assert.equal(empty.companyName, null);
  assert.equal(empty.targetAudience, null);
  assert.deepEqual(empty.competitors, []);
});

test("visible export and v2 block use server inputs even with stale export parameters", async () => {
  const html = await exportReport(report, {
    domainUrl: report.url, companyName: "Stale company", targetAudience: "Stale persona",
    competitors: ["https://stale.example.test"], analysisDate: "01.10.2026", crawledPagesCount: 3,
  });
  const data = block(html);
  assert.equal(data.companyName, "Example Instruments");
  assert.equal(data.persona, report.inputs.buyerPersonas);
  assert.ok(!html.includes("Stale company"));
  assert.ok(!html.includes("Stale persona"));
});

test("legacy fallback parses visible markup from a real generated document", async () => {
  const html = await exportReport({ ...report, inputs: undefined });
  const data = block(html);
  assert.equal(data.inputsSource, "form");
  const oldBlock = {
    domain: data.domain, companyName: data.companyName, exportDate: data.exportDate,
    gaioScore: data.gaioScore, scores: data.scores,
  };
  const legacy = html.replace(
    /(<script type="application\/json" id="gaio-analysis-data">)[\s\S]*?(<\/script>)/,
    `$1${JSON.stringify(oldBlock)}$2`,
  );
  const result = parseReportSetup(legacy);
  assert.equal(result.ok, true);
  assert.equal(result.source, "fallback");
  assert.deepEqual(result.setup.pages, report.crawledPages);
  assert.equal(result.setup.companyName, "Browser Company");
  assert.equal(result.setup.persona, "Browser Persona");
});

test("failed and HTML-mode exports also carry a v2 block", async () => {
  const failedHtml = await exportReport({ ...report, status: "failed", errors: ["Synthetic failure"] });
  const failed = block(failedHtml);
  assert.equal(failed.blockVersion, 2);
  assert.equal(failed.analysisId, report.id);
  assert.equal(failed.status, "failed");
  assert.deepEqual(parseReportSetup(failedHtml), { ok: false, reason: "failed_report" });
  assert.deepEqual(parseReportSetup(await exportReport({ ...report, mode: "html", url: null })), {
    ok: false, reason: "html_mode",
  });
});

test("exports a null status when the report status is not a string", async () => {
  const data = block(await exportReport({ ...report, status: undefined }));
  assert.equal(data.status, null);
});

test("the actual frontend fetch transport preserves unknown report.inputs", async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(report), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
  try {
    const received = await customFetch("/api/analyze/synthetic-analysis");
    assert.deepEqual(received.inputs, report.inputs);
    assert.equal(buildReportInputParams(received, form).inputsSource, "server");
  } finally {
    globalThis.fetch = fetchBefore;
  }
});