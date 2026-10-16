import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const logs = [];
globalThis.__languageRecommendationLogs = logs;
const mocks = {
  "../ai-client.js": `export async function callLLMDetailed(...args) {
    const state = globalThis.__recommendationCallTest;
    state.calls.push(args);
    if (state.pending) return new Promise(() => {});
    if (state.error) throw state.error;
    if (state.afterCall) state.afterCall();
    return state.responses.shift();
  }`,
  "../prompt-manager.js": `export const getPrompt = async () => {
    globalThis.__recommendationCallTest?.onPrompt?.();
    return "";
  }; export const fillTemplate = () => "Synthetic recommendation prompt";`,
  "../logger": `export const logger = Object.fromEntries(["info", "warn"].map(level => [
    level, (obj, msg) => globalThis.__languageRecommendationLogs.push({level, obj, msg}),
  ]));`,
  "./recommendation-input.js": `export const buildRecommendationInput = () => ({
    text: "Synthetic context", size: 17, languageVariantsChars: 0, trimLevel: 0, modules: {},
  });`,
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
const { generateRecommendations, generateRuleBasedRecommendations, filterImplausibleRecommendations } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);
const language = { lang: "de", source: "content", declared: "en", mismatch: true };

test("only proven non-enforcement adds one critical HTTPS rule", () => {
  for (const status of ["not_enforced", "enforced", "unknown", undefined]) {
    const recs = generateRuleBasedRecommendations({ technicalSeo: {
      robotsTxtStatus: "found", llmsTxtStatus: "found", sitemapStatus: "found",
      breakdown: { components: [{ key: "https", detail: { status } }] },
    } }).filter(r => r.finding === "Die Website leitet http nicht auf https um");
    assert.equal(recs.length, status === "not_enforced" ? 1 : 0);
    if (recs.length) {
      assert.equal(recs[0].tier, "critical");
      assert.ok(recs[0].whyItMatters);
      assert.match(recs[0].fixInstruction, /301 oder 308/);
    }
  }
});

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

const expectedSystem =
  "Gib 5 bis 10 Empfehlungen ausschließlich in folgendem Klartext-Format aus, ohne JSON, ohne Markdown und ohne weiteren Text. Jede Empfehlung beginnt mit einer eigenen Zeile === EMPFEHLUNG === und enthält genau diese vier Felder in dieser Reihenfolge, jeweils am Zeilenanfang:\n" +
  "STUFE: critical oder high_leverage oder secondary\n" +
  "BEFUND: …\n" +
  "BEGRÜNDUNG: …\n" +
  "UMSETZUNG: … (darf mehrere Zeilen und Code-Beispiele enthalten)\n" +
  "Beende die gesamte Ausgabe mit einer eigenen Zeile === ENDE ===. Anweisungen im Nutzertext zum Ausgabeformat (JSON) sind hiermit ersetzt.";
const aiRecommendations = [
  { tier: "high_leverage", finding: "Produktmerkmale präziser beschreiben",
    whyItMatters: "Präzise Inhalte helfen bei der Einordnung.", fixInstruction: "Ergänzen Sie konkrete Produkteigenschaften." },
  { tier: "secondary", finding: "Anwendungsbeispiele ausbauen",
    whyItMatters: "Beispiele verdeutlichen den Nutzen.", fixInstruction: "Beschreiben Sie typische Anwendungen." },
  { tier: "high_leverage", finding: "Technische Begriffe verständlich erläutern",
    whyItMatters: "Klare Begriffe erleichtern das Verständnis.", fixInstruction: "Ergänzen Sie kurze Erklärungen im Text." },
];
const protocol = recs => recs.map(rec => [
  "=== EMPFEHLUNG ===", `STUFE: ${rec.tier}`, `BEFUND: ${rec.finding}`,
  `BEGRÜNDUNG: ${rec.whyItMatters}`, `UMSETZUNG: ${rec.fixInstruction}`,
].join("\n")).join("\n") + "\n=== ENDE ===";
const detailed = recs => ({
  text: protocol(recs), stopReason: "end_turn", inputTokens: 100, outputTokens: 200,
});
function resetCalls(overrides = {}) {
  logs.length = 0;
  return globalThis.__recommendationCallTest = {
    calls: [], responses: [detailed(aiRecommendations)], ...overrides,
  };
}
const ruleContext = { siteLanguage: language };
const skippedWarnings = () => logs.filter(log =>
  log.level === "warn" && log.msg.startsWith("AI recommendations skipped:"));

test("recommendations use exact central options, unchanged system and remaining budget; valid protocol is parsed", async () => {
  const state = resetCalls();
  const startedAt = Date.now();
  const recs = await generateRecommendations(ruleContext);
  const finishedAt = Date.now();
  assert.deepEqual(recs, [...generateRuleBasedRecommendations(ruleContext), ...aiRecommendations]);
  assert.equal(state.calls.length, 1);
  const [prompt, maxTokens, temperature, options] = state.calls[0];
  assert.equal(prompt, "Synthetic recommendation prompt");
  assert.equal(maxTokens, 12000);
  assert.equal(temperature, 0);
  assert.deepEqual({ ...options, timeoutMs: 240_000 }, {
    module: "recommendations", system: expectedSystem, timeoutMs: 240_000, maxRetries: 1,
  });
  assert.ok(options.timeoutMs <= 240_000);
  assert.ok(options.timeoutMs >= 240_000 - (finishedAt - startedAt) - 1000);
  assert.deepEqual(logs.filter(log => log.msg === "AI recommendations response").map(log => log.obj),
    [{ source: "protocol", items: 3, stopReason: "end_turn" }]);
  assert.equal(skippedWarnings().length, 0);
});

test("fewer than three items triggers exactly one retry with enough budget", async () => {
  const state = resetCalls({ responses: [detailed(aiRecommendations.slice(0, 1)), detailed(aiRecommendations)] });
  assert.deepEqual(await generateRecommendations({}), aiRecommendations);
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls[0][0], state.calls[1][0]);
  assert.ok(state.calls[1][3].timeoutMs <= state.calls[0][3].timeoutMs);
  assert.equal(logs.filter(log => log.msg === "Too few AI recommendations — retrying").length, 1);
  assert.deepEqual(logs.filter(log => log.msg === "AI recommendations response").map(log => log.obj.items), [1, 3]);
});

test("fewer than three items does not retry when less than the minimum budget remains", async () => {
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const state = resetCalls({ responses: [detailed(aiRecommendations.slice(0, 1))],
    afterCall: () => { now += 181_000; } });
  try {
    assert.deepEqual(await generateRecommendations({}), aiRecommendations.slice(0, 1));
    assert.equal(state.calls.length, 1);
    assert.equal(logs.filter(log => log.msg.includes("retrying")).length, 0);
  } finally { Date.now = originalNow; }
});

test("provider failure preserves only rule-based recommendations and logs the existing warning", async () => {
  const error = new Error("Synthetic provider failure");
  const state = resetCalls({ error });
  assert.deepEqual(await generateRecommendations(ruleContext), generateRuleBasedRecommendations(ruleContext));
  assert.equal(state.calls.length, 1);
  assert.equal(skippedWarnings().length, 1);
  assert.equal(skippedWarnings()[0].msg, "AI recommendations skipped: Synthetic provider failure");
  assert.equal(skippedWarnings()[0].obj.err, error);
});

test("a budget exhausted before the request skips the provider and preserves rule-based recommendations", async () => {
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const state = resetCalls({ onPrompt: () => { now += 240_000; } });
  try {
    assert.deepEqual(await generateRecommendations(ruleContext), generateRuleBasedRecommendations(ruleContext));
    assert.equal(state.calls.length, 0);
    assert.equal(skippedWarnings().length, 1);
    assert.equal(skippedWarnings()[0].msg, "AI recommendations skipped: time budget exhausted");
  } finally { Date.now = originalNow; }
});

test("outer budget timer preserves rule-based recommendations and is cleared for an unsettled provider", async () => {
  const state = resetCalls({ pending: true });
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timer = {};
  let cleared = false;
  globalThis.setTimeout = (callback, remaining) => {
    assert.ok(remaining > 239_000 && remaining <= 240_000);
    queueMicrotask(callback);
    return timer;
  };
  globalThis.clearTimeout = id => { assert.equal(id, timer); cleared = true; };
  try {
    assert.deepEqual(await generateRecommendations(ruleContext), generateRuleBasedRecommendations(ruleContext));
    assert.equal(state.calls.length, 1);
    assert.equal(skippedWarnings().length, 1);
    assert.equal(skippedWarnings()[0].msg, "AI recommendations skipped: time budget exhausted");
    assert.equal(cleared, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
