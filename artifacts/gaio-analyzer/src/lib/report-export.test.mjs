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

const { labelDefaults } = await load("./labelDefaults.ts");
const languageFixture = { lang: "de", source: "content", declared: "en", mismatch: true };
function reliabilityFixture(succeeded = 27, evaluated = 11, siteLanguage) {
  return {
    ...report,
    crawledPages: Array.from({ length: evaluated }, (_, index) => `https://example.test/page-${index}`),
    crawlReliability: { attempted: succeeded, succeeded, failed: 0, failures: [] },
    ...(siteLanguage ? { siteLanguage } : {}),
  };
}
function exportedCard(html) {
  const start = html.indexOf(">Crawl-Zuverlässigkeit</div>");
  assert.ok(start >= 0);
  return html.slice(start, html.indexOf(">Gecrawlte Seiten", start));
}

test("HTML reliability distinguishes 27 fetched from 11 evaluated pages, in the requested tile order", async () => {
  const html = exportedCard(await exportReport(reliabilityFixture()));
  assert.match(html, /Erfolgreich abgerufen<\/div><div class="val" style="color:#22c55e;">✓ 27<\/div>/);
  assert.match(html, /Davon bewertet<\/div><div class="val">11<\/div>/);
  assert.match(html, /16 abgerufene Seite\(n\) nach dem Abruf aussortiert \(andere Sprache, identischer Inhalt oder keine Inhaltsseite, z\. B\. Bild oder Datei\)\./);
  const positions = ["Seiten versucht", "Erfolgreich abgerufen", "Davon bewertet", "Fehlgeschlagen"].map(text => html.indexOf(text));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
});

test("HTML sorted-out line is absent for equal counts and clamped when evaluated exceeds succeeded", async () => {
  for (const evaluated of [16, 17]) {
    const html = exportedCard(await exportReport(reliabilityFixture(16, evaluated)));
    assert.ok(!html.includes("nach dem Abruf aussortiert"));
    assert.match(html, new RegExp(`Davon bewertet</div><div class="val">${evaluated}</div>`));
  }
});

test("HTML evaluated count excludes uploaded-page and handles missing crawledPages", async () => {
  for (const crawledPages of [["uploaded-page", "https://example.test/one"], undefined]) {
    const html = await exportReport({ ...reliabilityFixture(1, 0), crawledPages });
    assert.match(html, new RegExp(`Davon bewertet</div><div class="val">${crawledPages ? 1 : 0}</div>`));
  }
});

test("HTML mismatch line uses the exact default text and recognized German or English name", async () => {
  for (const [lang, declared, content] of [["de", "en", "Deutsch"], ["en", "de", "Englisch"]]) {
    const html = exportedCard(await exportReport(reliabilityFixture(27, 11, { ...languageFixture, lang, declared })));
    const expected = labelDefaults["results.crawl_lang_mismatch"].de
      .replace("{declared}", declared).replace("{content}", content);
    assert.ok(html.includes(expected));
    assert.ok(html.indexOf("nach dem Abruf aussortiert") < html.indexOf(expected));
    assert.match(html, /<p style="font-size:12px;color:[^;]+;margin-bottom:12px;">Die Sprachangabe der Website/);
  }
});

test("HTML omits mismatch text for false, missing, or unrecognized language metadata", async () => {
  for (const siteLanguage of [undefined, { ...languageFixture, mismatch: false }, { ...languageFixture, lang: "fr" }, { ...languageFixture, lang: null }]) {
    const html = await exportReport(reliabilityFixture(16, 16, siteLanguage));
    assert.ok(!html.includes("Die Sprachangabe der Website"));
  }
});

test("HTML escapes the declared language value", async () => {
  const declared = 'en"><img src=x onerror="alert(1)">&$&';
  const html = exportedCard(await exportReport(reliabilityFixture(27, 11, { ...languageFixture, declared })));
  assert.ok(html.includes('lang="en&quot;&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;$&amp;"'));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("{declared}"));
});

test("failed HTML reports pass evaluated count and language metadata to the same card", async () => {
  const html = await exportReport({ ...reliabilityFixture(27, 11, languageFixture), status: "failed", errors: ["Fixture failure"] });
  assert.match(html, /Davon bewertet<\/div><div class="val">11<\/div>/);
  assert.match(html, /16 abgerufene Seite\(n\) nach dem Abruf aussortiert/);
  assert.ok(html.includes('lang="en") passt nicht zum erkannten Inhalt (Deutsch)'));
});

test("results defaults add one language-variant label and retain the crawl text defaults", () => {
  assert.equal(Object.keys(labelDefaults).length, 1079 + 1);
  for (const [key, de] of Object.entries({
    crawl_succeeded: "Erfolgreich abgerufen",
    crawl_evaluated: "Davon bewertet",
    crawl_sorted_out: "{n} abgerufene Seite(n) nach dem Abruf aussortiert (andere Sprache, identischer Inhalt oder keine Inhaltsseite, z. B. Bild oder Datei).",
    crawl_skipped_noncontent: "{n} Seite(n) ohne verwertbaren Inhalt (z. B. Bildanzeige, Datei, kaum Text)",
    crawl_lang_mismatch: 'Die Sprachangabe der Website (lang="{declared}") passt nicht zum erkannten Inhalt ({content}). Die Analyse richtet sich nach dem Inhalt.',
    lang_name_de: "Deutsch",
    lang_name_en: "Englisch",
    lang_variant_info: "Die eingegebene Adresse zeigt die Sprachversion „{fromLang}“. Analysiert wurde die deutsche Sprachversion: {to}",
  })) {
    assert.deepEqual(labelDefaults[`results.${key}`], { group: "results", de });
  }
});

// Render the real live-card expression, without the rest of the view or an API.
const resultsSource = await readFile(new URL("../views/ErgebnisseView.tsx", import.meta.url), "utf8");
const cardStart = resultsSource.indexOf("{crawlReliability && Number(");
const cardEnd = resultsSource.indexOf("})()}", cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart);
const cardExpression = resultsSource.slice(cardStart, cardEnd + "})()}".length);
globalThis.__crawlCardReact = React;
const { outputFiles: liveFiles } = await build({
  stdin: {
    loader: "tsx",
    contents: `
      const React = globalThis.__crawlCardReact;
      const Card = ({ children, ...props }) => React.createElement("section", props, children);
      const CardHeader = Card, CardTitle = Card, CardContent = Card;
      const CheckCircle2 = () => React.createElement("svg");
      export function LiveCard({ report, t }) {
        const crawlReliability = report.crawlReliability;
        const crawlSkipped = report.crawlSkipped;
        const siteLanguage = report.siteLanguage;
        return <>${cardExpression}</>;
      }
    `,
  },
  write: false, format: "esm", jsx: "transform",
});
const { LiveCard } = await import(`data:text/javascript;base64,${Buffer.from(liveFiles[0].contents).toString("base64")}`);
function liveCard(value, overrides = {}) {
  const t = (key, vars = {}) => (overrides[key] ?? labelDefaults[key]?.de ?? key)
    .replace(/\{(\w+)\}/g, (placeholder, name) => vars[name] === undefined ? placeholder : String(vars[name]));
  return renderToStaticMarkup(React.createElement(LiveCard, { report: value, t }));
}

test("live card has four responsive tiles and renders both conditional lines with the new labels", () => {
  const html = liveCard(reliabilityFixture(27, 11, languageFixture));
  assert.match(html, /grid-cols-1 sm:grid-cols-4/);
  assert.match(html, /Erfolgreich abgerufen<\/p><p[^>]*>27<\/p>/);
  assert.match(html, /Davon bewertet<\/p><p[^>]*>11<\/p>/);
  assert.match(html, /16 abgerufene Seite\(n\) nach dem Abruf aussortiert/);
  assert.ok(html.includes('lang=&quot;en&quot;) passt nicht zum erkannten Inhalt (Deutsch)'));
  assert.match(html, /<p class="text-xs text-muted-foreground">Die Sprachangabe/);
  assert.match(cardExpression, /t\("results\.lang_name_en"\)/);
});

test("live card omits sorted-out and mismatch lines when their conditions are not met", () => {
  for (const siteLanguage of [undefined, { ...languageFixture, mismatch: false }, { ...languageFixture, lang: "fr" }]) {
    const html = liveCard(reliabilityFixture(16, 16, siteLanguage));
    assert.ok(!html.includes("nach dem Abruf aussortiert"));
    assert.ok(!html.includes("Die Sprachangabe der Website"));
  }
});

test("live evaluated count excludes uploaded-page and mismatch declaration is rendered as text", () => {
  const html = liveCard({
    ...reliabilityFixture(2, 0, { ...languageFixture, declared: '<img src=x onerror="alert(1)">' }),
    crawledPages: ["uploaded-page", "https://example.test/page"],
  });
  assert.match(html, /Davon bewertet<\/p><p[^>]*>1<\/p>/);
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
});

test("live card continues to use label overrides", () => {
  const html = liveCard(reliabilityFixture(16, 16), { "results.crawl_succeeded": "Admin override" });
  assert.ok(html.includes("Admin override"));
  assert.ok(!html.includes("Erfolgreich abgerufen"));
});

test("non-content skips alone show the skipped block and identical new text in live and HTML cards", async () => {
  const value = {
    ...reliabilityFixture(3, 1),
    crawlSkipped: { otherLanguage: 0, excludedPath: 0, duplicate: 0, nonContent: 2, urls: [] },
  };
  const expected = "2 Seite(n) ohne verwertbaren Inhalt (z. B. Bildanzeige, Datei, kaum Text)";
  for (const html of [liveCard(value), await exportReport(value)]) {
    assert.ok(html.includes("Nicht bewertete Seiten"));
    assert.ok(html.includes(expected));
    assert.ok(html.includes("andere Sprache, identischer Inhalt oder keine Inhaltsseite, z. B. Bild oder Datei"));
  }
});

test("both renderers omit the non-content line for zero or absent counts, including older skipped metadata", async () => {
  for (const nonContent of [0, undefined]) {
    const value = {
      ...reliabilityFixture(3, 2),
      crawlSkipped: { otherLanguage: 1, excludedPath: 0, duplicate: 0, nonContent, urls: [] },
    };
    for (const html of [liveCard(value), await exportReport(value)]) {
      assert.ok(html.includes("Nicht bewertete Seiten"));
      assert.ok(!html.includes("Seite(n) ohne verwertbaren Inhalt"));
    }
  }
});

const noticeStart = resultsSource.indexOf("{homepageRedirect && (", resultsSource.indexOf("{/* Details Tab */}"));
assert.ok(noticeStart >= 0 && noticeStart < cardStart);
const failedNoticeStart = resultsSource.indexOf("{isFailed && failedHomepageRedirect && (");
const failedNoticeEnd = resultsSource.indexOf("{isFailed && (", failedNoticeStart);
assert.ok(failedNoticeStart >= 0 && failedNoticeEnd > failedNoticeStart);
const { outputFiles: noticeFiles } = await build({
  stdin: {
    loader: "tsx",
    contents: `
      const React = globalThis.__crawlCardReact;
      const formatRedirectUrl = value => { const url = new URL(value); return url.origin + url.pathname; };
      export function LiveNotices({report, t}) {
        const homepageRedirect = report.homepageRedirect;
        const languageVariant = report.languageVariant;
        return <>${resultsSource.slice(noticeStart, cardStart)}</>;
      }
      export function FailedNotices({report, t}) {
        const isFailed = true;
        const failedHomepageRedirect = report.homepageRedirect;
        const failedLanguageVariant = report.languageVariant;
        return <>${resultsSource.slice(failedNoticeStart, failedNoticeEnd)}</>;
      }`,
  },
  platform: "node", format: "esm", write: false,
});
const { LiveNotices, FailedNotices } = await import(`data:text/javascript;base64,${Buffer.from(noticeFiles[0].contents).toString("base64")}`);
function liveNotices(value, overrides = {}, Component = LiveNotices) {
  const t = (key, vars = {}) => (overrides[key] ?? labelDefaults[key]?.de ?? key)
    .replace(/\{(\w+)\}/g, (placeholder, name) => vars[name] === undefined ? placeholder : String(vars[name]));
  return renderToStaticMarkup(React.createElement(Component, { report: value, t }));
}

test("language variant notice matches both renderers, maps language names, links the escaped URL and follows redirect info", async () => {
  for (const [fromLang, name] of [["en", "Englisch"], ["de", "Deutsch"], ["fr", "FR"], [null, "unbekannt"]]) {
    const to = 'https://example.test/de/?a="b"&q=<fixture>';
    const value = { ...reliabilityFixture(4, 3), languageVariant: { from: report.url, to, fromLang, toLang: "de" },
      homepageRedirect: { from: "https://original.test/", to: "https://example.test/" } };
    for (const html of [liveNotices(value), liveNotices(value, {}, FailedNotices), await exportReport(value)]) {
      assert.ok(html.includes(`Die eingegebene Adresse zeigt die Sprachversion „${name}“. Analysiert wurde die deutsche Sprachversion:`));
      assert.ok(html.includes('href="https://example.test/de/?a=&quot;b&quot;&amp;q=&lt;fixture&gt;"'));
      assert.ok(!html.includes("<fixture>"));
      assert.ok(html.indexOf("Startseite leitet") < html.indexOf("Die eingegebene Adresse"));
    }
    assert.match(liveNotices(value), /text-muted-foreground/);
    assert.match(liveNotices(value), /class="underline hover:no-underline"/);
  }
});

test("language variant notice is absent for legacy reports, null metadata and competitor-only switches", async () => {
  for (const languageVariant of [null, undefined]) {
    const value = { ...report, languageVariant, competitors: [{ url: "https://rival.test", languageVariant: { from: "https://rival.test", to: "https://rival.test/de", fromLang: "en", toLang: "de" } }] };
    for (const html of [liveNotices(value), liveNotices(value, {}, FailedNotices), await exportReport(value)]) {
      assert.ok(!html.includes("Die eingegebene Adresse zeigt"));
    }
  }
});

test("live language notice respects label overrides; HTML includes it in failed reports too without changing the entered URL", async () => {
  const value = { ...report, languageVariant: { from: report.url, to: "https://example.test/de/", fromLang: "en", toLang: "de" } };
  assert.match(liveNotices(value, { "results.lang_variant_info": "Variant {fromLang}: {to}", "results.lang_name_en": "English override" }), /Variant English override:/);
  const html = await exportReport({ ...value, status: "failed", errors: ["Synthetic failure"] });
  assert.ok(html.includes("Die eingegebene Adresse zeigt"));
  assert.equal(block(html).url, report.url);
  assert.equal(block(html).domain, report.url);
});