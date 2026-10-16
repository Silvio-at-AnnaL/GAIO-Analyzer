import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: { contents: `export { faqNoSchemaHint } from "./faq-hint";
    export { generateHtmlReport } from "./report-export";
    export { defaultTechnicalT } from "./technical-breakdown";
    export { labelDefaults } from "./labelDefaults";`,
  resolveDir: new URL(".", import.meta.url).pathname },
  bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env.BASE_URL": '"/"' },
});
const { faqNoSchemaHint, generateHtmlReport, defaultTechnicalT: t, labelDefaults } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const faq = { score: 35, visiblePairCount: 3, hasFaqSchema: false, breakdown: { schema: { points: 0, max: 27 } } };
async function html(data, translate = t) {
  const before = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try { return await generateHtmlReport({ status: "completed", url: "https://example.test", faqQuality: data, crawledPages: [] }, { t: translate }); }
  finally { globalThis.fetch = before; }
}

test("FAQ hint uses the label and actual schema maximum, not a fixed 40", async () => {
  const hint = faqNoSchemaHint(faq, t);
  assert.ok(hint.includes("27 Punkte"));
  assert.equal(hint, t("results.faq_no_schema_hint", { points: 27 }));
  assert.ok((await html(faq)).includes(hint));
  assert.equal(labelDefaults["results.faq_no_schema_hint"].group, "results");
  assert.equal(Object.keys(labelDefaults).length, 1324);
});

test("FAQ export honors a label override and escapes translated text", async () => {
  const translate = (key, params) => key === "results.faq_no_schema_hint" ? `Override <FAQ>: ${params.points}` : t(key, params);
  assert.equal(faqNoSchemaHint(faq, translate), "Override <FAQ>: 27");
  assert.ok((await html(faq, translate)).includes("Override &lt;FAQ&gt;: 27"));
});

test("FAQ hint is absent when schema exists or visible pairs are zero or missing", async () => {
  for (const data of [{ ...faq, hasFaqSchema: true }, { ...faq, visiblePairCount: 0 }, { ...faq, visiblePairCount: undefined }]) {
    assert.equal(faqNoSchemaHint(data, t), null);
    assert.ok(!(await html(data)).includes("Ihre FAQ-Inhalte stehen im HTML"));
  }
  assert.equal(faqNoSchemaHint({ ...faq, breakdown: undefined }, t), null);
});

test("results FAQ card and HTML export both use the same translated hint", async () => {
  const results = await readFile(new URL("../views/ErgebnisseView.tsx", import.meta.url), "utf8");
  assert.match(results, /faqNoSchemaHint\(faqQuality, t\)/);
  assert.ok(!results.includes("Ihre FAQ-Inhalte stehen im HTML"));
});

test("technical evaluated-weight line has the same inline typography as the robots summary", async () => {
  const source = await readFile(new URL("./report-export.ts", import.meta.url), "utf8");
  assert.ok(source.includes('<p style="font-size:12px;color:${C.textSec};margin:6px 0;">${esc(t("technical.evaluated_weight"'));
  assert.ok(source.includes('<p style="font-size:12px;color:${C.textSec};margin:6px 0;">${esc(robotsAnalysis.summary)}'));
});
