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
      name: "content-relevance-test-mocks",
      setup(builder) {
        builder.onResolve({ filter: /^cheerio$/ }, () => ({
          path: import.meta.resolve("cheerio"),
          external: true,
        }));
        builder.onResolve({ filter: /.*/ }, (args) => (
          Object.hasOwn(mocks, args.path)
            ? { path: args.path, namespace: "content-test" }
            : undefined
        ));
        builder.onLoad({ filter: /.*/, namespace: "content-test" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}

const state = {
  answer: "",
  prompt: "",
  logs: [],
  template: "",
  updates: [],
  cleared: [],
};
globalThis.__contentRelevanceTest = state;

const loggerMock = `
  export const logger = {
    info(obj, msg) { globalThis.__contentRelevanceTest.logs.push({ level: "info", msg: msg ?? obj, obj: msg ? obj : {} }); },
    warn(obj, msg) { globalThis.__contentRelevanceTest.logs.push({ level: "warn", msg: msg ?? obj, obj: msg ? obj : {} }); },
  };
`;
const { extractMainText, extractPageText, analyzeContentRelevance } = await loadWithMocks("./content-relevance.ts", {
  "../ai-client.js": `
    export async function callLLM(prompt) {
      globalThis.__contentRelevanceTest.prompt = prompt;
      return globalThis.__contentRelevanceTest.answer;
    }
  `,
  "../prompt-manager.js": `
    export async function getPrompt() { return "{{CRAWLED_CONTENT}}"; }
    export function fillTemplate(template, vars) {
      return template.replaceAll("{{CRAWLED_CONTENT}}", vars.CRAWLED_CONTENT);
    }
  `,
  "../logger": loggerMock,
});

const { migrateContentRelevancePrompt, PREVIOUS_CONTENT_RELEVANCE_TEMPLATE } = await loadWithMocks("../admin-db.ts", {
  "bcryptjs": `export default { hash: async () => "not-used" };`,
  "./db.js": `
    export async function query(sql, params) {
      const state = globalThis.__contentRelevanceTest;
      if (sql.includes("UPDATE prompts SET")) {
        state.updates.push(params);
        if (state.template === params[4]) {
          state.template = params[0];
          return { rows: [{ slug: params[3] }] };
        }
        return { rows: [] };
      }
      if (sql.includes("SELECT template FROM prompts")) {
        return { rows: [{ template: state.template }] };
      }
      throw new Error("Unexpected SQL in migration test");
    }
  `,
  "./logger.js": loggerMock,
  "./prompt-manager.js": `
    export function clearPromptCache(slug) { globalThis.__contentRelevanceTest.cleared.push(slug); }
  `,
});

const expectedKeys = ["use_cases", "buyer_questions", "technical_depth", "completeness"];
function response(dimensions) {
  return JSON.stringify({ dimensions });
}
function dimension(key, score, name = key) {
  return { key, name, score, findings: ["Befund"] };
}
function page(index, length = 20_000) {
  return { url: `https://example.com/${index}`, html: `<main>${"X".repeat(length)}</main>` };
}
function reset() {
  state.answer = response(expectedKeys.map((key) => dimension(key, 5)));
  state.prompt = "";
  state.logs = [];
  state.updates = [];
  state.cleared = [];
}

test("removes a link-dense div mega menu before the H1", () => {
  const menu = `<div>${`<a href="/menu">Menüpunkt Beschreibung Produktgruppe Zubehör</a>`.repeat(100)}</div>`;
  const html = `<body>${menu}<section><h1>Silikon-Schrumpfschläuche</h1><p>Technische Daten und Anwendungen.</p></section></body>`;
  assert.ok(extractMainText(html, 4000).startsWith("Silikon-Schrumpfschläuche"));
  assert.ok(extractPageText(html, 4000).startsWith("Menüpunkt"));
});

test("uses only the first main element when one exists", () => {
  assert.equal(
    extractMainText("<div>Vorher</div><main><h1>Hauptinhalt</h1><p>Details</p></main><article>Später</article>", 100),
    "HauptinhaltDetails",
  );
});

test("does not erase a homepage with teasers and an H1", () => {
  const html = `<body><section><h1>Industrieprodukte</h1>${`<a href="/x">Produkt</a>`.repeat(40)}
    <p>Wichtige Informationen zur Produktauswahl für Industriekunden.</p></section></body>`;
  assert.ok(extractMainText(html, 4000).startsWith("Industrieprodukte"));
});

test("ten pages get 4,000 body characters each in crawl order", async () => {
  reset();
  await analyzeContentRelevance(Array.from({ length: 10 }, (_, index) => page(index)), "");
  const log = state.logs.find(({ msg }) => msg === "content relevance input built").obj;
  assert.equal(log.pageCount, 10);
  assert.equal(log.perPageChars, 4000);
  assert.equal(log.totalChars, 40_000);
  assert.deepEqual(log.pages.map(({ chars }) => chars), Array(10).fill(4000));
  assert.ok(state.prompt.startsWith("--- Page: https://example.com/0 ---\n"));
  assert.ok(state.prompt.includes("--- Page: https://example.com/9 ---\n"));
});

test("three pages get 13,333 body characters each", async () => {
  reset();
  await analyzeContentRelevance([page(0), page(1), page(2)], "");
  const log = state.logs.find(({ msg }) => msg === "content relevance input built").obj;
  assert.equal(log.perPageChars, 13_333);
  assert.deepEqual(log.pages.map(({ chars }) => chars), [13_333, 13_333, 13_333]);
  assert.equal(log.totalChars, 39_999);
});

test("more than ten pages excludes later pages", async () => {
  reset();
  await analyzeContentRelevance(Array.from({ length: 12 }, (_, index) => page(index)), "");
  const log = state.logs.find(({ msg }) => msg === "content relevance input built").obj;
  assert.equal(log.pageCount, 10);
  assert.ok(!state.prompt.includes("--- Page: https://example.com/10 ---"));
});

test("maps out-of-order keys and rounds scores to integer bounds", async () => {
  reset();
  state.answer = response([
    dimension("completeness", 12),
    dimension("technical_depth", 8.6),
    dimension("use_cases", -3),
    dimension("buyer_questions", 4),
  ]);
  const result = await analyzeContentRelevance([page(0)], "");
  assert.deepEqual(result.dimensions.map(({ name }) => name),
    ["use_cases", "buyer_questions", "technical_depth", "completeness"]);
  assert.deepEqual(result.dimensions.map(({ score }) => score), [0, 4, 9, 10]);
  assert.equal(result.score, 58);
  assert.equal(result.failed, undefined);
});

test("maps missing keys by position without reusing a keyed dimension", async () => {
  reset();
  state.answer = response([
    dimension("completeness", 10),
    { name: "Legacy buyer", score: 7, findings: [] },
    dimension("technical_depth", 6),
    dimension("use_cases", 5),
  ]);
  const result = await analyzeContentRelevance([page(0)], "");
  assert.deepEqual(result.dimensions.map(({ score }) => score), [5, 7, 6, 10]);
});

test("three dimensions produce the existing failed result", async () => {
  reset();
  state.answer = response(expectedKeys.slice(0, 3).map((key) => dimension(key, 8)));
  const result = await analyzeContentRelevance([page(0)], "");
  assert.equal(result.failed, true);
  assert.equal(result.score, 50);
});

test("migrates only the verbatim old default and clears the cache", async () => {
  reset();
  state.template = PREVIOUS_CONTENT_RELEVANCE_TEMPLATE;
  await migrateContentRelevancePrompt();
  assert.equal(state.updates.length, 1);
  assert.equal(state.template, state.updates[0][0]);
  assert.ok(state.template.includes('"key":"completeness"'));
  assert.ok(state.logs.some(({ level, msg }) => level === "info" && msg === "content-relevance prompt migrated"));
  assert.deepEqual(state.cleared, ["content-relevance"]);
  reset();
  await migrateContentRelevancePrompt();
  assert.equal(state.updates.length, 1);
  assert.ok(!state.logs.some(({ level }) => level === "warn"));
});

test("leaves a customized template untouched and warns", async () => {
  reset();
  state.template = "Custom admin prompt";
  await migrateContentRelevancePrompt();
  assert.equal(state.template, "Custom admin prompt");
  assert.ok(state.logs.some(({ level, msg }) =>
    level === "warn" && msg === "content-relevance prompt customized – not migrated"));
  assert.deepEqual(state.cleared, ["content-relevance"]);
});