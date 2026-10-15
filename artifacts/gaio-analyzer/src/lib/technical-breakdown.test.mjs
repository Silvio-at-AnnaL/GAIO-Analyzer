import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function load(entry) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", write: false,
    define: { "import.meta.env.BASE_URL": '"/"' },
    jsx: "automatic",
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}
const { TechnicalScoreBreakdown } = await load("../components/TechnicalScoreBreakdown.tsx");
const { technicalDetail, technicalTooltip, defaultTechnicalT: t } = await load("./technical-breakdown.ts");
const { renderTechnicalBreakdownHtml, generateHtmlReport } = await load("./report-export.ts");
const breakdown = {
  components: [
    { key: "title", weight: 18, fraction: .5, points: 9, detail: { outOfRange: 3, pages: 16, duplicate: 2, missing: 1 } },
    { key: "https", weight: 10, fraction: 0, points: 0, detail: { status: "not_enforced" } },
    { key: "hreflang", weight: 5, fraction: null, points: null, detail: { versions: false, present: 0, pages: 16 } },
  ],
  evaluatedWeight: 28, params: { title_min: 22, title_max: 66, desc_min: 65, desc_max: 190 },
};
const report = {
  id: "synthetic", status: "completed", url: "https://example.test", overallScore: 70,
  crawledPages: ["https://example.test"],
  technicalSeo: { score: 70, metaTitles: { present: 1 }, metaDescriptions: { present: 1 }, breakdown },
};
test("both technical breakdown renderers show recovered-after-retry counts without changing legacy details", () => {
  const crawl = { key: "crawl", weight: 10, fraction: 0.75, points: 7.5,
    detail: { attempted: 4, succeeded: 4, recoveredAfterRetry: 2 } };
  const value = { ...breakdown, components: [crawl], evaluatedWeight: 10 };
  const expected = "4 von 4 Seitenabrufen erfolgreich; davon 2 erst nach Wiederholung";
  assert.equal(technicalDetail(crawl, t), expected);
  const ui = renderToStaticMarkup(React.createElement(TechnicalScoreBreakdown, { breakdown: value, t }));
  const html = renderTechnicalBreakdownHtml(value, t);
  assert.ok(ui.includes(expected));
  assert.ok(html.includes(expected));
  assert.equal(technicalDetail({ key: "crawl", detail: { attempted: 4, succeeded: 4 } }, t),
    "4 von 4 Seitenabrufen erfolgreich");
});
async function exportHtml(value, opts) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try { return await generateHtmlReport(value, opts); } finally { globalThis.fetch = previous; }
}
test("results component and HTML breakdown show German labels, raw weighted points and null explanations", () => {
  const ui = renderToStaticMarkup(React.createElement(TechnicalScoreBreakdown, { breakdown, t }));
  const html = renderTechnicalBreakdownHtml(breakdown, t);
  for (const rendered of [ui, html]) {
    assert.match(rendered, /Aufschlüsselung des Scores/);
    assert.match(rendered, /3 von 16 zu kurz\/lang, 2 doppelt, 1 fehlend/);
    assert.match(rendered, /http leitet nicht auf https um/);
    assert.match(rendered, /einsprachig – nicht bewertet/);
    assert.match(rendered, /nicht bewertbar/);
    assert.match(rendered, />9<\/td>/);
  }
});
test("old results without a breakdown render without the table in both outputs", async () => {
  assert.equal(renderToStaticMarkup(React.createElement(TechnicalScoreBreakdown, { t })), "");
  assert.equal(renderTechnicalBreakdownHtml(undefined, t), "");
  const html = await exportHtml({ ...report, technicalSeo: { ...report.technicalSeo, breakdown: undefined } });
  assert.ok(!html.includes("Aufschlüsselung des Scores"));
  assert.ok(html.includes("Technische SEO-Basis"));
});
test("HTML export and results tooltips use stored thresholds, including historical reports", async () => {
  const html = await exportHtml(report);
  assert.match(html, /22–66 Zeichen/);
  assert.match(html, /65–190 Zeichen/);
  assert.ok(!html.includes("50–60 Zeichen"));
  assert.ok(!html.includes("70–160 Zeichen"));
  assert.match(technicalTooltip("title", breakdown, t), /22–66/);
  assert.match(technicalTooltip("description", breakdown, t), /65–190/);
  assert.match(technicalTooltip("title", undefined, t), /15–75/);
});
test("new export strings use supplied translations and escape component detail text", async () => {
  const translated = await exportHtml(report, { t: (key, vars) => key === "technical.breakdown_title" ? 'Score <"explanation">' : t(key, vars) });
  assert.match(translated, /Score &lt;&quot;explanation&quot;&gt;/);
  assert.ok(!translated.includes('Score <"explanation">'));
});
test("all component detail variants are translated without backend prose", () => {
  for (const [key, detail] of Object.entries({
    crawl: { attempted: 4, succeeded: 3 }, robots: { status: "error" },
    sitemap: { status: "found", type: "html" }, indexable: { noindex: 1, pages: 3 },
    canonical: { valid: 2, pages: 3 }, viewport: { present: 1, pages: 3 },
    alt: { present: 0, images: 0 }, response: { avgMs: 1700, goodMs: 1000, okMs: 2000 },
    hreflang: { versions: true, present: 2, pages: 3 }, https: { uploaded: true },
  })) {
    const text = technicalDetail({ key, detail }, t);
    assert.ok(!text.includes("technical."), text);
    assert.ok(!text.includes("{"), text);
  }
});
test("results wire the real breakdown and score settings render profiles generically", async () => {
  const view = await readFile(new URL("../views/ErgebnisseView.tsx", import.meta.url), "utf8");
  assert.match(view, /<TechnicalScoreBreakdown breakdown=\{technicalSeo\.breakdown/);
  assert.match(view, /technicalTooltip\("title", technicalSeo\.breakdown/);
  const settings = await readFile(new URL("../views/admin/ScoreSettingsView.tsx", import.meta.url), "utf8");
  assert.match(settings, /profiles\.map/);
});
