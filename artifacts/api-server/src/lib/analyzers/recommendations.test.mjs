import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const logs = [];
globalThis.__languageRecommendationLogs = logs;
const mocks = {
  "@workspace/integrations-anthropic-ai": `export const anthropic = {};`,
  "../prompt-manager.js": `export const getPrompt = async () => ""; export const fillTemplate = () => "";`,
  "../logger": `export const logger = { info() {}, warn(obj, msg) { globalThis.__languageRecommendationLogs.push({ obj, msg }); } };`,
  "./recommendation-input.js": `export const buildRecommendationInput = () => ({});`,
};
const { outputFiles } = await build({
  entryPoints: [new URL("./recommendations.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "language-recommendation-mocks",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: "language-test" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "language-test" }, args => ({
        contents: mocks[args.path], loader: "js",
      }));
    },
  }],
});
const { generateRuleBasedRecommendations, filterImplausibleRecommendations } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);
const language = { lang: "de", source: "content", declared: "en", mismatch: true };

test("mismatch adds the exact high-leverage rule, even without a technical SEO result", () => {
  assert.deepEqual(generateRuleBasedRecommendations({ siteLanguage: language }), [{
    tier: "high_leverage",
    finding: 'Sprachangabe im Quelltext passt nicht zum Inhalt: Die Seiten sind als lang="en" gekennzeichnet, der Text ist deutsch.',
    whyItMatters: "Das lang-Attribut im <html>-Tag teilt Browsern, Screenreadern, Übersetzungsfunktionen sowie Such- und KI-Crawlern mit, in welcher Sprache eine Seite verfasst ist. Weicht es vom tatsächlichen Inhalt ab, können Systeme, die sich auf diese Angabe stützen, die Inhalte der falschen Sprache zuordnen.",
    fixInstruction: 'Setzen Sie im <html>-Tag aller deutschsprachigen Seiten lang="de" statt lang="en". In den meisten CMS steuert das die eingestellte Standardsprache der Website.',
  }]);
  const english = generateRuleBasedRecommendations({ siteLanguage: { ...language, lang: "en", declared: "de" } })[0];
  assert.match(english.finding, /der Text ist englisch\.$/);
  assert.match(english.fixInstruction, /englischsprachigen Seiten lang="en" statt lang="de"/);
});

test("no mismatch or no site language produces no language rule", () => {
  for (const siteLanguage of [null, undefined, { ...language, mismatch: false }]) {
    assert.deepEqual(generateRuleBasedRecommendations({ siteLanguage }), []);
  }
});

test("AI html-lang topics are dropped only when the language rule is present; hreflang topics are preserved", () => {
  const recs = [
    "Lang-Attribut fehlt", 'Sprachkennung lang="de" korrigieren',
    "HTML lang ist falsch", "Sprachattribut korrigieren", "Sprachangabe im Quelltext stimmt nicht",
    "hreflang-Attribut ergänzen", "Semantische Struktur verbessern",
  ].map(finding => ({ tier: "high_leverage", finding, whyItMatters: "", fixInstruction: "" }));
  recs[5].whyItMatters = "hreflang ergänzt das HTML lang Attribut.";
  const context = { languageVariants: [{ lang: "de" }, { lang: "en" }] };
  const filtered = filterImplausibleRecommendations(recs, { ...context, siteLanguage: language });
  assert.deepEqual(filtered.kept, recs.slice(5));
  assert.equal(filtered.dropped.length, 5);
  assert.ok(filtered.dropped.every(item => item.rule === "lang_attribute_rule_based"));
  assert.ok(logs.every(log => log.obj.rule === "lang_attribute_rule_based" && log.msg === "implausible AI recommendation dropped"));
  assert.deepEqual(filterImplausibleRecommendations(recs, { ...context, siteLanguage: { ...language, mismatch: false } }).kept, recs);
});
