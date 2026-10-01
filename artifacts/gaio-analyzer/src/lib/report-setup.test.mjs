import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { parseReportSetup, normalizePageUrl } = await (async () => {
  const { outputFiles } = await build({
    entryPoints: [new URL("./report-setup.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
})();

function v2Block(overrides = {}) {
  return {
    blockVersion: 2,
    analysisId: "analysis-synthetic-17",
    mode: "domain",
    url: "https://example.test/",
    companyName: "Example Industries",
    exportDate: "2025-01-02T03:04:05.000Z",
    persona: "Operations leads",
    competitors: ["https://rival-one.example.test", "https://rival-two.example.test"],
    pages: ["https://example.test/", "https://example.test/about"],
    requestedPages: ["https://example.test/", "https://example.test/contact"],
    pageSelection: "manual",
    ...overrides,
  };
}

function blockHtml(block) {
  return `<script type="application/json" id="gaio-analysis-data">${JSON.stringify(block)}</script>`;
}

function fallbackReport({ pageCount = 3, pages = null, persona = "Facilities &amp; IT teams" } = {}) {
  const pageLinks = pages ?? [
    `<li><a href="https://example.test/one?a=1&amp;b=2">One</a></li>`,
    `<li><a href="https://example.test/two?x=&lt;ok&gt;">Two</a></li>`,
    `<li><a href="https://example.test/three?quote=&quot;yes&quot;">Three</a></li>`,
  ];
  return `<!doctype html>
<html lang="de"><body>
  <h2>Analyseparameter dieser Auswertung</h2>
  <div><table><tbody>
    <tr><td>Analysierte Domain</td><td><a href="https://example.test/?x=1&amp;y=2">https://example.test/</a></td></tr>
    <tr><td>Unternehmensname</td><td>Example &lt;Works&gt; &quot;North&quot; &#39;Group&#39; &#x26; Co.</td></tr>
    <tr><td>Zielgruppen / Käuferpersonas</td><td>${persona}</td></tr>
    <tr><td>Wettbewerber-Domains</td><td>
      <a href="https://competitor-one.example.test/?a=1&amp;b=2">Competitor one</a>
      <a href='https://competitor-two.example.test/path?tag=&#35;1'>Competitor two</a>
    </td></tr>
    <tr><td>Gecrawlte Seiten</td><td>999</td></tr>
  </tbody></table></div>
  <div style="font-size:13px;font-weight:600;color:#777;margin:4px 0 2px;">Gecrawlte Seiten (${pageCount})</div>
  <ul style="margin:4px 0;padding-left:16px;">
    ${pageLinks.join("\n")}
  </ul>
</body></html>`;
}

test("parses version 2 setup fields and warns when a requested page was not analyzed", () => {
  const result = parseReportSetup(blockHtml(v2Block()));
  assert.deepEqual(result, {
    ok: true,
    source: "block-v2",
    setup: {
      url: "https://example.test/",
      companyName: "Example Industries",
      persona: "Operations leads",
      competitors: ["https://rival-one.example.test", "https://rival-two.example.test"],
      pages: ["https://example.test/", "https://example.test/about"],
      requestedPages: ["https://example.test/", "https://example.test/contact"],
      pageSelection: "manual",
      analysisId: "analysis-synthetic-17",
      exportDate: "2025-01-02T03:04:05.000Z",
    },
    warnings: ["requested_pages_not_analyzed"],
  });
});

test("normalizes only scheme, host, default ports, and empty root paths", () => {
  assert.equal(
    normalizePageUrl("HTTPS://WWW.THUMM-ONLINE.DE"),
    "https://www.thumm-online.de/",
  );
  assert.equal(
    normalizePageUrl("HTTP://Example.TEST:80/a/../b?Q=%2f#Frag"),
    "http://example.test/a/../b?Q=%2f#Frag",
  );
  assert.equal(
    normalizePageUrl("https://Example.TEST:443/%2e/../path?x=1#Part"),
    "https://example.test/%2e/../path?x=1#Part",
  );
  assert.equal(
    normalizePageUrl("https://Example.TEST:8443/path"),
    "https://example.test:8443/path",
  );
});

test("does not warn when requested and analyzed URLs differ only by scheme/host case, default port, or root slash", () => {
  const result = parseReportSetup(blockHtml(v2Block({
    pages: ["https://www.thumm-online.de/"],
    requestedPages: ["HTTPS://WWW.THUMM-ONLINE.DE:443"],
  })));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.setup.pages, ["https://www.thumm-online.de/"]);
});

test("warns when more than five competitors are present while preserving all parser data", () => {
  const competitors = Array.from(
    { length: 6 },
    (_, index) => `https://rival-${index + 1}.example.test`,
  );
  const result = parseReportSetup(blockHtml(v2Block({ competitors, requestedPages: null })));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.setup.competitors, competitors);
  assert.deepEqual(result.warnings, ["competitors_truncated"]);
});

test("uses the old block and exact visible markup for fallback fields and ordered pages", () => {
  const oldBlock = {
    domain: "https://legacy.example.test/",
    companyName: "Legacy Example",
    exportDate: "2024-11-10T12:00:00.000Z",
  };
  const result = parseReportSetup(`${blockHtml(oldBlock)}${fallbackReport()}`);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.source, "fallback");
  assert.deepEqual(result.setup, {
    url: "https://example.test/?x=1&y=2",
    companyName: 'Example <Works> "North" \'Group\' & Co.',
    persona: "Facilities & IT teams",
    competitors: [
      "https://competitor-one.example.test/?a=1&b=2",
      "https://competitor-two.example.test/path?tag=#1",
    ],
    pages: [
      "https://example.test/one?a=1&b=2",
      "https://example.test/two?x=<ok>",
      'https://example.test/three?quote="yes"',
    ],
    requestedPages: null,
    pageSelection: null,
    analysisId: null,
    exportDate: "2024-11-10T12:00:00.000Z",
  });
  assert.deepEqual(result.warnings, []);
});

test("reports a fallback page count mismatch without confusing the table count row for a list", () => {
  const result = parseReportSetup(fallbackReport({ pageCount: 4 }));
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.setup.pages, [
    "https://example.test/one?a=1&b=2",
    "https://example.test/two?x=<ok>",
    'https://example.test/three?quote="yes"',
  ]);
  assert.deepEqual(result.warnings, ["page_count_mismatch"]);
});

test("returns html_mode for a version 2 HTML-upload report", () => {
  assert.deepEqual(
    parseReportSetup(blockHtml(v2Block({ mode: "html" }))),
    { ok: false, reason: "html_mode" },
  );
});

test("returns not_a_report for unrelated HTML", () => {
  assert.deepEqual(
    parseReportSetup("<!doctype html><html><body><h1>Example</h1></body></html>"),
    { ok: false, reason: "not_a_report" },
  );
});

test("returns no_setup_data when a recognized report has no usable URL", () => {
  assert.deepEqual(parseReportSetup(blockHtml(v2Block({ url: "  " }))), {
    ok: false,
    reason: "no_setup_data",
  });
  assert.deepEqual(
    parseReportSetup(`<h2>${"Analyseparameter dieser Auswertung"}</h2><table></table>`),
    { ok: false, reason: "no_setup_data" },
  );
});

test("does not throw on malformed blocks and falls back to visible report data", () => {
  const result = parseReportSetup(
    `<script id="gaio-analysis-data" type="application/json">{"blockVersion":2</script>${fallbackReport()}`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "fallback");
  assert.equal(result.setup.url, "https://example.test/?x=1&y=2");
});

test("validates malformed v2 fields without throwing or accepting an invalid page selection", () => {
  const result = parseReportSetup(blockHtml(v2Block({
    competitors: ["https://valid.example.test", 23],
    pages: ["https://example.test/valid"],
    requestedPages: ["https://example.test/missing", null],
    pageSelection: "unexpected",
    persona: 42,
  })));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.setup.competitors, []);
  assert.deepEqual(result.setup.pages, ["https://example.test/valid"]);
  assert.equal(result.setup.requestedPages, null);
  assert.equal(result.setup.pageSelection, null);
  assert.equal(result.setup.persona, null);
  assert.deepEqual(result.warnings, ["persona_not_found"]);
});

test("treats unknown block versions as legacy fallback instead of v2", () => {
  const result = parseReportSetup(
    `${blockHtml({ blockVersion: 9, domain: "https://legacy.example.test/" })}${fallbackReport()}`,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "fallback");
  assert.equal(result.setup.url, "https://example.test/?x=1&y=2");
  assert.equal(result.setup.pageSelection, null);
});

test("rejects version 2 and fallback reports with no pages", () => {
  assert.deepEqual(
    parseReportSetup(blockHtml(v2Block({ pages: [] }))),
    { ok: false, reason: "no_pages" },
  );

  const html = fallbackReport({ pages: null, persona: "" }).replace(
    /<ul\b[^>]*>[\s\S]*?<\/ul>/,
    "",
  );
  assert.deepEqual(parseReportSetup(html), { ok: false, reason: "no_pages" });
});

test("rejects failed v2 reports", () => {
  assert.deepEqual(
    parseReportSetup(blockHtml(v2Block({ status: "failed" }))),
    { ok: false, reason: "failed_report" },
  );
});

test("decodes decimal and hexadecimal character references in hrefs and visible text", () => {
  const result = parseReportSetup(fallbackReport({
    pageCount: 1,
    pages: [`<li><a href="https://example.test/page?symbol=&#169;&amp;mark=&#x2603;">Page</a></li>`],
    persona: "Teams&#32;who&#39;ve opted in",
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.setup.persona, "Teams who've opted in");
  assert.deepEqual(result.setup.pages, ["https://example.test/page?symbol=©&mark=☃"]);
  assert.deepEqual(result.warnings, []);
});