import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

async function load(entry) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", write: false,
    define: { "import.meta.env.BASE_URL": '"/"' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}

const { MIN_COMPARABLE_PAGES, isLimitedCompetitor } = await load("./competitor-comparability.ts");
const { labelDefaults } = await load("./labelDefaults.ts");
const { generateHtmlReport } = await load("./report-export.ts");
const badge = "Eingeschränkt vergleichbar";
const note = count => `Nur ${count} Seite(n) analysiert – die Werte beruhen auf einer kleinen Stichprobe und sind nur eingeschränkt vergleichbar.`;
const overview = names => `Eingeschränkt vergleichbar (weniger als 3 analysierte Seiten): ${names}`;

for (const [count, error, expected] of [
  [1, undefined, true],
  [2, undefined, true],
  [3, undefined, false],
  [5, undefined, false],
  [0, "Nicht erreichbar", false],
  [1, "Nicht auswertbar", false],
  [0, undefined, false],
]) {
  test(`comparability: ${count} pages${error ? " with error" : " without error"} → ${expected}`, () => {
    assert.equal(MIN_COMPARABLE_PAGES, 3);
    assert.equal(isLimitedCompetitor({ crawledPagesCount: count, error }), expected);
  });
}

function competitor(name, count, overrides = {}) {
  return {
    name, url: `https://${name.toLowerCase()}.example.test`,
    crawledPagesCount: count,
    technicalScore: 61, schemaScore: 62, contentScore: 63,
    headingScore: 64, faqScore: 65, compositeScore: 77,
    ...overrides,
  };
}

async function exportCompetitors(competitors, comparison = {}) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    return await generateHtmlReport({
      id: "synthetic-comparability", mode: "url", status: "completed",
      url: "https://main.example.test", overallScore: 80,
      competitorComparison: { competitors, mainComparisonScore: 70, ...comparison },
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function tableRow(html, name) {
  const table = html.match(/<table class="comp-table">([\s\S]*?)<\/table>/)?.[1];
  assert.ok(table);
  const row = [...table.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)]
    .map(([row]) => row).find(row => row.includes(`<td>${name}`));
  assert.ok(row);
  return row;
}

function card(html, name) {
  const start = html.indexOf(`<strong style="font-size:15px;">${name}`);
  assert.ok(start >= 0);
  const next = html.indexOf('<div class="comp-card">', start);
  return html.slice(start, next < 0 ? html.indexOf('id="gaio-analysis-data"', start) : next);
}

test("HTML marks only the two-page competitor in the table, card and overview; scores stay unchanged", async () => {
  const html = await exportCompetitors([competitor("Limited", 2), competitor("Full", 5)]);
  const limitedRow = tableRow(html, "Limited");
  assert.match(limitedRow, />Eingeschränkt vergleichbar<\/span>/);
  assert.match(limitedRow, /background:#fef3c7;color:#92400e;border:1px solid #f59e0b/);
  assert.ok(limitedRow.indexOf("Limited") < limitedRow.indexOf(badge));
  for (const score of [61, 62, 63, 64, 65, 77]) {
    assert.match(limitedRow, new RegExp(`>${score}<`));
    assert.match(tableRow(html, "Full"), new RegExp(`>${score}<`));
  }
  const limitedCard = card(html, "Limited");
  assert.ok(limitedCard.includes(`>${badge}</span>`));
  assert.ok(limitedCard.includes(note(2)));
  assert.match(limitedCard, /<\/div>\s*<p style="font-size:12px;color:[^;]+;margin:6px 0;">Nur 2 Seite\(n\) analysiert/);
  assert.ok(!tableRow(html, "Full").includes(badge));
  assert.ok(!card(html, "Full").includes(badge));
  assert.ok(!card(html, "Full").includes(note(5)));
  assert.equal([...html.matchAll(/>Eingeschränkt vergleichbar<\/span>/g)].length, 2);
  assert.ok(html.includes(overview("Limited")));
  assert.ok(!html.includes(overview("Limited, Full")));
});

test("HTML without limited competitors contains none of the new messages and keeps error badges", async () => {
  const html = await exportCompetitors([
    competitor("Three", 3), competitor("Five", 5),
    competitor("Unreachable", 0, { error: "Nicht erreichbar" }),
    competitor("Js", 1, { error: "Nicht auswertbar", errorReason: "js_rendered" }),
  ]);
  assert.ok(!html.includes(badge));
  assert.ok(!html.includes("Seite(n) analysiert – die Werte"));
  assert.match(tableRow(html, "Unreachable"), />Nicht erreichbar<\/span>/);
  assert.match(tableRow(html, "Js"), />Nicht auswertbar<\/span>/);
});

test("HTML lists all and only limited names, places the overview after existing footnotes, and escapes names", async () => {
  const html = await exportCompetitors([
    competitor("One", 1),
    competitor("Two", 2, { name: "Two & <Company>" }),
    competitor("Full", 5),
  ], { excludedModules: ["technical"] });
  const expectedOverview = overview("One, Two &amp; &lt;Company&gt;");
  assert.ok(html.includes(expectedOverview));
  assert.ok(html.indexOf(expectedOverview) > html.indexOf("Vergleichswert: gleiche Gewichtung"));
  assert.ok(html.indexOf(expectedOverview) > html.indexOf("¹ Nicht im Vergleichswert berücksichtigt"));
  assert.ok(html.includes(note(1)));
  assert.ok(html.includes(note(2)));
  assert.ok(!html.includes("Two & <Company>"));
});

test("live renderer uses the shared rule and renders all three labels conditionally", async () => {
  const source = await readFile(new URL("../views/ErgebnisseView.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ isLimitedCompetitor \} from "@\/lib\/competitor-comparability"/);
  assert.match(source, /const isLimited = isLimitedCompetitor\(competitor\)/);
  assert.match(source, /const limitedCompetitors = competitorComparison\?\.competitors\.filter\(isLimitedCompetitor\) \?\? \[\]/);
  assert.match(source, /isLimited && \([\s\S]*?t\("results\.competitor_limited_badge"\)/);
  assert.match(source, /isLimited && \(\s*<p className="text-xs text-muted-foreground">\s*\{t\("results\.competitor_limited_note", \{ count: competitor\.crawledPagesCount \}\)/);
  assert.match(source, /limitedCompetitors\.length > 0 && \([\s\S]*?t\("results\.competitor_limited_overview", \{[\s\S]*?names: limitedCompetitors\.map\(\(competitor\) => competitor\.name\)\.join\(", "\)/);
});

test("the three new results labels exactly match the HTML messages", async () => {
  const expected = {
    "results.competitor_limited_badge": badge,
    "results.competitor_limited_note": note("{count}"),
    "results.competitor_limited_overview": overview("{names}"),
  };
  for (const [key, de] of Object.entries(expected)) {
    assert.deepEqual(labelDefaults[key], { group: "results", de });
  }
  assert.equal(Object.keys(labelDefaults).filter(key => key.startsWith("results.competitor_limited_")).length, 3);
  const html = await exportCompetitors([competitor("Limited", 2)]);
  for (const value of [badge, note(2), overview("Limited")]) assert.ok(html.includes(value));
});
