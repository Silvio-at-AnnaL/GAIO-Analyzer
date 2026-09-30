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

const state = { inputs: {}, callInputs: {}, next: 0, calls: [], answers: {}, logs: [] };
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
    export async function callLLM(prompt) {
      const state = globalThis.__llmDiscoverabilityTest;
      const slug = prompt.split("#")[0];
      state.calls.push(slug);
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
const R = "llm-discoverability-rating";
const reset = () => {
  state.inputs = {};
  state.callInputs = {};
  state.next = 0;
  state.calls = [];
  state.logs = [];
  state.answers = {
    [A]: JSON.stringify({ questions: ["Frage A?"] }),
    [B]: JSON.stringify({ questions: ["Frage B?"] }),
    [R]: JSON.stringify({ ratings: [{ rating: 4, gap: "Lücke", sourceUrl: "https://example.com/0" }] }),
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

test("uses full mode for short pages", async () => {
  reset();
  await analyzeLlmDiscoverability([page(0, `<h1>Produkt</h1><p>Details</p>`)], "");
  assert.equal(inputLog().rating.pages[0].mode, "full");
  assert.equal(state.inputs[R].PAGES_DOC, "[PAGE 1] URL: https://example.com/0\nProduktDetails");
});

test("long FAQ pages retain a 1500-character intro and <=2500-character FAQ part", async () => {
  reset();
  const question = "Welche Anwendung ist vorgesehen?";
  const answer = "B".repeat(3000);
  await analyzeLlmDiscoverability([
    page(0, `<h1>Produkt</h1>${"I".repeat(5000)}`, faqSchema(question, answer)),
  ], "");
  assert.equal(inputLog().rating.pages[0].mode, "intro+faq");
  assert.equal(inputLog().rating.pages[0].faqPairs, 1);
  const body = state.inputs[R].PAGES_DOC.split("\n", 1)[0];
  const ratedText = state.inputs[R].PAGES_DOC.slice(body.length + 1);
  const [intro, faq] = ratedText.split("\n[FAQ]\n");
  assert.equal(intro.length, 1500);
  assert.equal(faq.length, 2500);
  assert.ok(faq.startsWith(`F: ${question}\nA: `));
  assert.equal(ratedText.length, 4007);
});

test("the FAQ part counts separators and keeps whole later pairs", async () => {
  reset();
  const q1 = "Erste Frage?";
  const q2 = "Zweite Frage?";
  const schema = `<script type="application/ld+json">${JSON.stringify({
    "@type": "FAQPage",
    mainEntity: [
      { name: q1, acceptedAnswer: { text: "A".repeat(1200) } },
      { name: q2, acceptedAnswer: { text: "B".repeat(1200) } },
    ],
  })}</script>`;
  await analyzeLlmDiscoverability([page(0, "X".repeat(5000), schema)], "");
  const faq = state.inputs[R].PAGES_DOC.split("\n[FAQ]\n")[1];
  assert.ok(faq.includes(`\n\nF: ${q2}\nA: `));
  assert.ok(faq.length <= 2500);
});

test("long pages without FAQs are truncated at 4000 characters", async () => {
  reset();
  await analyzeLlmDiscoverability([page(0, "X".repeat(5000))], "");
  assert.equal(inputLog().rating.pages[0].mode, "truncated");
  assert.equal(state.inputs[R].PAGES_DOC.split("\n").slice(1).join("\n").length, 4000);
});

test("only first ten of twelve pages are included, with no 10000/12000 global cut", async () => {
  reset();
  await analyzeLlmDiscoverability(Array.from({ length: 12 }, (_, i) => page(i, "X".repeat(5000))), "");
  const log = inputLog();
  assert.equal(log.pageCount, 10);
  assert.equal(log.generation.pages.length, 10);
  assert.equal(log.rating.pages.length, 10);
  assert.ok(state.inputs[A].COMBINED_CONTENT.includes("URL: https://example.com/9"));
  assert.ok(state.inputs[R].PAGES_DOC.includes("[PAGE 10] URL: https://example.com/9"));
  assert.ok(!state.inputs[A].COMBINED_CONTENT.includes("URL: https://example.com/10"));
  assert.ok(!state.inputs[R].PAGES_DOC.includes("[PAGE 11]"));
  assert.ok(state.inputs[R].PAGES_DOC.length > 12000);
});

test("FAQ pairs are extracted per page, without cross-page deduplication", async () => {
  reset();
  const schema = faqSchema("Gleiche Frage?", "Gleiche Antwort.");
  await analyzeLlmDiscoverability([page(0, "A".repeat(5000), schema), page(1, "B".repeat(5000), schema)], "");
  assert.deepEqual(inputLog().rating.pages.map(({ faqPairs }) => faqPairs), [1, 1]);
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

test("returns null on rating count mismatch, non-numeric rating, or rating call failure", async () => {
  for (const answer of [
    JSON.stringify({ ratings: [] }),
    JSON.stringify({ ratings: [{ rating: "3" }] }),
    new Error("Rating failed"),
  ]) {
    reset();
    state.answers[R] = answer;
    assert.equal(await analyzeLlmDiscoverability([page(0, "Text")], ""), null);
    assert.ok(state.logs.some(({ msg, obj }) => msg === "llm discoverability unavailable" && obj.reason));
  }
});

test("keeps original questions and score weights; clamps ratings and validates source URLs", async () => {
  reset();
  state.answers[A] = JSON.stringify({ questions: ["Original A1?", "Original A2?"] });
  state.answers[B] = JSON.stringify({ questions: ["Original B?"] });
  state.answers[R] = ({ QUESTIONS }) => {
    const questions = JSON.parse(QUESTIONS);
    return JSON.stringify({ ratings: questions.map((_, i) => ({
      question: "Vom Modell ersetzt?",
      rating: questions.length === 2 ? (i ? 3.2 : 99) : -5,
      gap: "Erkenntnis",
      sourceUrl: i ? "https://invalid.example" : "https://example.com/0",
    })) });
  };
  const result = await analyzeLlmDiscoverability([page(0, "Text")], "");
  assert.equal(result.partA.score, 80);
  assert.equal(result.partB.score, 20);
  assert.equal(result.score, Math.round(80 * 0.7 + 20 * 0.3));
  assert.deepEqual(result.questions.map(({ question }) => question), ["Original A1?", "Original A2?", "Original B?"]);
  assert.deepEqual(result.questions.map(({ rating }) => rating), [5, 3, 1]);
  assert.deepEqual(result.questions.map(({ sourceUrl }) => sourceUrl),
    ["https://example.com/0", null, "https://example.com/0"]);
});

test("logs actual input lengths and persists the INFO message", async () => {
  reset();
  await analyzeLlmDiscoverability([page(0, "Text"), page(1, "Weitere Details")], "");
  const log = inputLog();
  assert.ok(PERSISTED_INFO_MESSAGES.has("llm discoverability input built"));
  assert.equal(log.pageCount, 2);
  assert.equal(log.generation.totalChars, state.inputs[A].COMBINED_CONTENT.length);
  assert.equal(log.rating.totalChars, state.inputs[R].PAGES_DOC.length);
  assert.deepEqual(log.generation.pages.map(({ url, chars }) => [url, chars]),
    ["URL: https://example.com/0\nTitle: Test Titel\nText",
      "URL: https://example.com/1\nTitle: Test Titel\nWeitere Details"]
      .map((block, index) => [`https://example.com/${index}`, block.length]));
  assert.deepEqual(log.rating.pages.map(({ mode, faqPairs }) => [mode, faqPairs]),
    [["full", 0], ["full", 0]]);
});