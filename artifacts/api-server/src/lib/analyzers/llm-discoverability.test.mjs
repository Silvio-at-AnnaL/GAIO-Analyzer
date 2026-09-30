import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

async function loadWithMocks(entry, mocks) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [{
      name: "llm-discoverability-test-mocks",
      setup(builder) {
        builder.onResolve({ filter: /^cheerio$/ }, () => ({
          path: import.meta.resolve("cheerio"),
          external: true,
        }));
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "test-mock" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "test-mock" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}

const state = { inputs: {}, callInputs: {}, next: 0, calls: [], moduleCalls: [], answers: {}, logs: [] };
globalThis.__llmDiscoverabilityTest = state;
const loggerMock = `
  export const logger = {
    info(obj, msg) { globalThis.__llmDiscoverabilityTest.logs.push({ level: "info", msg: msg ?? obj, obj }); },
    warn(obj, msg) { globalThis.__llmDiscoverabilityTest.logs.push({ level: "warn", msg: msg ?? obj, obj }); },
  };
  export function setLogSink() {}
`;
const { analyzeLlmDiscoverability } = await loadWithMocks("./llm-discoverability.ts", {
  "../ai-client.js": `
    export async function callLLM(prompt, maxTokens, temperature, options) {
      const state = globalThis.__llmDiscoverabilityTest;
      const slug = prompt.split("#")[0];
      state.calls.push(slug);
      state.moduleCalls.push({ slug, module: options?.module, maxTokens, temperature });
      const response = state.answers[slug];
      if (response instanceof Error) throw response;
      return typeof response === "function" ? response(state.callInputs[prompt]) : response;
    }
  `,
  "../prompt-manager.js": `
    export async function getPrompt(slug) { return slug; }
    export function fillTemplate(template, vars) {
      const state = globalThis.__llmDiscoverabilityTest;
      state.inputs[template] = vars;
      const key = template + "#" + ++state.next;
      state.callInputs[key] = vars;
      return key;
    }
  `,
  "../logger": loggerMock,
});
const { PERSISTED_INFO_MESSAGES } = await loadWithMocks("../system-events.ts", {
  "./db.js": "export async function query() { throw new Error('not used'); }",
  "./logger.js": loggerMock,
});

const A = "llm-discoverability-a";
const B = "llm-discoverability-b";
const R = "llm-discoverability-rating-v2";
const reset = () => {
  state.inputs = {};
  state.callInputs = {};
  state.next = 0;
  state.calls = [];
  state.moduleCalls = [];
  state.logs = [];
  state.answers = {
    [A]: JSON.stringify({ questions: ["Frage A?"] }),
    [B]: JSON.stringify({ questions: ["Frage B?"] }),
    [R]: JSON.stringify({ ratings: [
      { id: "q1", rating: 4, gap: "Lücke", sourceUrl: "https://example.com/0" },
      { id: "b1", rating: 4, gap: "Lücke", sourceUrl: "https://example.com/0" },
    ] }),
  };
};
function page(index, main, extra = "", title = "  Test   Titel  ") {
  return {
    url: `https://example.com/${index}`,
    html: `<html><head><title>${title}</title>${extra}</head><body><main>${main}</main></body></html>`,
  };
}
function faqSchema(question, answer) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@type": "FAQPage",
    mainEntity: [{ name: question, acceptedAnswer: { text: answer } }],
  })}</script>`;
}
function inputLog() {
  return state.logs.find(({ msg }) => msg === "llm discoverability input built")?.obj;
}

test("generation excludes a plain div/ul mega menu and uses title and <=600 main characters", async () => {
  reset();
  const menu = `<div><ul>${`<li><a href="/menu">Kategorie Produkte Zubehör</a></li>`.repeat(120)}</ul></div>`;
  const html = `<html><head><title>  Silikon   Produkte </title></head><body>${menu}
    <section><h1>Silikon-Schrumpfschläuche</h1><p>${"Anwendung ".repeat(100)}</p></section></body></html>`;
  await analyzeLlmDiscoverability([{ url: "https://example.com/0", html }], "");
  const block = state.inputs[A].COMBINED_CONTENT;
  assert.ok(block.startsWith("URL: https://example.com/0\nTitle: Silikon Produkte\nSilikon-Schrumpfschläuche"));
  assert.ok(!block.includes("Kategorie Produkte Zubehör"));
  assert.ok(block.split("\n").slice(2).join("\n").length <= 600);
  assert.equal(state.inputs[B].COMBINED_CONTENT, block);
});

test("cuts the generation excerpt before the first FAQ question near the start", async () => {
  reset();
  const question = "Welche Temperatur ist möglich?";
  const main = `<h1>Produkt</h1><p>Einleitung. ${question} Dazu die Antwort.</p>`;
  await analyzeLlmDiscoverability([page(0, main, faqSchema(question, "Bis 200 Grad."))], "");
  const excerpt = state.inputs[A].COMBINED_CONTENT.split("\n").slice(2).join("\n");
  assert.ok(excerpt.startsWith("ProduktEinleitung."));
  assert.ok(!excerpt.includes(question));
});

test("returns null when Part A has no questions", async () => {
  reset();
  state.answers[A] = JSON.stringify({ questions: [] });
  assert.equal(await analyzeLlmDiscoverability([page(0, "Text")], ""), null);
  assert.equal(state.calls.includes(R), false);
  assert.ok(state.logs.some(({ level, msg, obj }) =>
    level === "warn" && msg === "llm discoverability unavailable" && obj.reason));
});

test("returns null when Part B fails or yields no questions, without fallback questions", async () => {
  reset();
  state.answers[B] = new Error("Part B failed");
  assert.equal(await analyzeLlmDiscoverability([page(0, "Text")], ""), null);
  assert.equal(state.calls.includes(R), false);
  reset();
  state.answers[B] = JSON.stringify({ questions: [] });
  assert.equal(await analyzeLlmDiscoverability([page(0, "Text")], ""), null);
  assert.equal(state.calls.includes(R), false);
});

test("returns null for missing, duplicate, unknown, or non-numeric rating ids", async () => {
  for (const answer of [
    { ratings: [{ id: "q1", rating: 3 }] },
    { ratings: [{ id: "q1", rating: 3 }, { id: "q1", rating: 4 }] },
    { ratings: [{ id: "q1", rating: 3 }, { id: "unknown", rating: 4 }] },
    { ratings: [{ id: "q1", rating: "3" }, { id: "b1", rating: 4 }] },
  ]) {
    reset();
    state.answers[R] = JSON.stringify(answer);
    assert.equal(await analyzeLlmDiscoverability([page(0, "Text")], ""), null);
    assert.ok(state.logs.some(({ msg, obj }) => msg === "llm discoverability unavailable" && obj.reason));
  }
});

test("uses one v2 rating call and formats question-specific passage blocks with ids", async () => {
  reset();
  state.answers[A] = JSON.stringify({ questions: [
    "Welche Kühlleistung bietet Thermoflex?",
    "Welche Druckwerte bietet Flexrohr?",
  ] });
  state.answers[B] = JSON.stringify({ questions: ["Welche Garantie bietet Nordwerk?"] });
  state.answers[R] = JSON.stringify({ ratings: [
    { id: "q1", rating: 3, gap: "Kühlleistung.", sourceUrl: "https://example.com/0" },
    { id: "q2", rating: 3, gap: "Druckwerte.", sourceUrl: "https://example.com/1" },
    { id: "b1", rating: 3, gap: "Garantie.", sourceUrl: "https://example.com/2" },
  ] });
  await analyzeLlmDiscoverability([
    page(0, "Thermoflex Kühlleistung beträgt 42 Kilowatt."),
    page(1, "Flexrohr arbeitet mit Druckwerten bis 8 Bar."),
    page(2, "Nordwerk gewährt Garantie für fünf Jahre."),
  ], "");

  assert.equal(state.calls.filter((slug) => slug === R).length, 1);
  assert.deepEqual(state.moduleCalls.filter(({ module }) => module === "llm-discoverability-rating"), [
    { slug: R, module: "llm-discoverability-rating", maxTokens: 8192, temperature: 0 },
  ]);
  assert.equal(state.inputs[R].QUESTION_BLOCKS, [
    "[q1] Welche Kühlleistung bietet Thermoflex?",
    "--- Passage 1 (URL: https://example.com/0)",
    "Thermoflex Kühlleistung beträgt 42 Kilowatt.",
    "",
    "[q2] Welche Druckwerte bietet Flexrohr?",
    "--- Passage 1 (URL: https://example.com/1)",
    "Flexrohr arbeitet mit Druckwerten bis 8 Bar.",
    "",
    "[b1] Welche Garantie bietet Nordwerk?",
    "--- Passage 1 (URL: https://example.com/2)",
    "Nordwerk gewährt Garantie für fünf Jahre.",
  ].join("\n"));
});

test("maps ratings by id, preserves generated questions, and limits source URLs per question", async () => {
  reset();
  state.answers[A] = JSON.stringify({ questions: ["Wie funktioniert Kobaltfilter?"] });
  state.answers[B] = JSON.stringify({ questions: ["Welche Werte hat Quarzpumpe?"] });
  state.answers[R] = JSON.stringify({ ratings: [
    { id: "b1", rating: 5, gap: "Gedeckt.", sourceUrl: "https://example.com/0" },
    { id: "q1", rating: 1, gap: "Fehlt.", sourceUrl: "https://example.com/0" },
  ] });
  const result = await analyzeLlmDiscoverability([
    page(0, "Kobaltfilter arbeitet mit Aktivkohle."),
    page(1, "Quarzpumpe fördert Wasser mit 6 Litern."),
  ], "");
  assert.deepEqual(result.questions.map(({ question }) => question), [
    "Wie funktioniert Kobaltfilter?", "Welche Werte hat Quarzpumpe?",
  ]);
  assert.deepEqual(result.questions.map(({ rating, sourceUrl }) => [rating, sourceUrl]), [
    [1, "https://example.com/0"], [5, null],
  ]);
  assert.equal(result.partA.score, 0);
  assert.equal(result.partB.score, 100);
});

test("a rating of three maps to a part score of 50", async () => {
  reset();
  state.answers[R] = JSON.stringify({ ratings: [
    { id: "q1", rating: 3, gap: "Teilweise.", sourceUrl: null },
    { id: "b1", rating: 3, gap: "Teilweise.", sourceUrl: null },
  ] });
  const result = await analyzeLlmDiscoverability([page(0, "Text")], "");
  assert.equal(result.partA.score, 50);
  assert.equal(result.partB.score, 50);
});

test("logs both INFO messages with their new fields and persists them", async () => {
  reset();
  const faqQuestion = "Welche Temperatur bietet Titanhülse?";
  const answer = "Die Temperatur der Titanhülse beträgt 180 Grad.";
  state.answers[A] = JSON.stringify({ questions: [faqQuestion] });
  state.answers[B] = JSON.stringify({ questions: ["Welche Lösung bietet Zirkon?"] });
  state.answers[R] = JSON.stringify({ ratings: [
    { id: "q1", rating: 4, gap: "Temperatur genannt.", sourceUrl: "https://example.com/0" },
    { id: "b1", rating: 2, gap: "Keine Angabe.", sourceUrl: null },
  ] });
  await analyzeLlmDiscoverability([
    page(0, `Einleitung. ${faqQuestion} ${answer}`, faqSchema(faqQuestion, answer)),
    page(1, "Zirkon ist eine technische Lösung."),
  ], "");
  const built = inputLog();
  const selected = state.logs.find(({ msg }) => msg === "llm discoverability passages selected")?.obj;
  assert.ok(PERSISTED_INFO_MESSAGES.has("llm discoverability input built"));
  assert.ok(PERSISTED_INFO_MESSAGES.has("llm discoverability passages selected"));
  assert.equal(built.pageCount, 2);
  assert.equal(built.generation.totalChars, state.inputs[A].COMBINED_CONTENT.length);
  assert.deepEqual(built.generation.pages, [
    {
      url: "https://example.com/0",
      chars: "URL: https://example.com/0\nTitle: Test Titel\nEinleitung. ".length,
    },
    {
      url: "https://example.com/1",
      chars: "URL: https://example.com/1\nTitle: Test Titel\nZirkon ist eine technische Lösung.".length,
    },
  ]);
  assert.deepEqual(Object.keys(built.rating).sort(), ["faqPassages", "pages", "passages"]);
  assert.equal(built.rating.passages, 3);
  assert.equal(built.rating.faqPassages, 1);
  assert.deepEqual(built.rating.pages.map(({ url, passages, chars }) => [url, passages, chars > 0]), [
    ["https://example.com/0", 2, true],
    ["https://example.com/1", 1, true],
  ]);
  assert.deepEqual(Object.keys(selected), ["questions", "excludedTerms"]);
  assert.deepEqual(selected.excludedTerms, []);
  assert.deepEqual(selected.questions.map(({ id, fallback }) => [id, fallback]), [
    ["q1", false],
    ["b1", false],
  ]);
  for (const entry of selected.questions) {
    assert.ok(Number.isInteger(entry.chars));
    assert.ok(entry.passages.length > 0);
    for (const passage of entry.passages) {
      assert.ok(passage.url);
      assert.equal(passage.score, Math.round(passage.score * 100) / 100);
    }
  }
});

test("excludes company and hostname terms from both parts and logs only removed tokens", async () => {
  for (const { url, company, expected } of [
    { url: "https://www.rotima.ch", company: "Rotima GmbH, Kaufbeuren", expected: ["rotima", "gmbh", "kaufbeur"] },
    { url: "https://de.farnell.com", company: "", expected: ["farnell"] },
  ]) {
    reset();
    const brand = company || "Farnell";
    const subject = "Silikonschrumpfschläuche";
    state.answers[A] = JSON.stringify({ questions: [`Welche ${subject} bietet ${brand}?`] });
    state.answers[B] = JSON.stringify({ questions: [`Welche ${subject} bietet ${brand}?`] });
    state.answers[R] = JSON.stringify({ ratings: [
      { id: "q1", rating: 4, gap: "Erklärt.", sourceUrl: null },
      { id: "b1", rating: 4, gap: "Erklärt.", sourceUrl: null },
    ] });
    const pages = [
      page(0, company ? "Rotima GmbH, Kaufbeuren." : "Farnell Ltd, London."),
      page(1, `${subject} isolieren elektrische Leitungen.`),
    ];
    const result = await analyzeLlmDiscoverability(pages, "", { companyName: company, url });
    assert.ok(result);
    const selected = state.logs.find(({ msg }) => msg === "llm discoverability passages selected")?.obj;
    assert.deepEqual(selected.excludedTerms, expected);
    for (const question of selected.questions) {
      assert.equal(question.fallback, false);
      assert.equal(question.passages[0].url, pages[1].url);
      assert.ok(!question.passages.some(({ url: passageUrl }) => passageUrl === pages[0].url));
    }
  }
});

test("excludes a hostname token without excluding a generic company placeholder", async () => {
  reset();
  state.answers[A] = JSON.stringify({ questions: ["Was bietet das Unternehmen bei Farnell?"] });
  state.answers[B] = JSON.stringify({ questions: ["Was bietet de.farnell.com?"] });
  await analyzeLlmDiscoverability([page(0, "Farnell führt Leitungen.")], "", {
    url: "https://de.farnell.com",
  });
  const selected = state.logs.find(({ msg }) => msg === "llm discoverability passages selected")?.obj;
  assert.deepEqual(selected.excludedTerms, ["farnell"]);
});