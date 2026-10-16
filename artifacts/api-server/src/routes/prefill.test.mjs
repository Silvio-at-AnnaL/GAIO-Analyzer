import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const state = { handlers: new Map(), loads: 0, aiCalls: 0, logs: [], requests: [] };
globalThis.__prefillExclusionTest = state;
const mocks = {
  express: `export function Router() { return { post(path, fn) { globalThis.__prefillExclusionTest.handlers.set(path, fn); } }; }`,
  "../lib/ai-client.js": `export async function callLLMDetailed(prompt, maxTokens, temperature, options) {
    const state = globalThis.__prefillExclusionTest;
    state.aiCalls++;
    state.lastAiCall = {prompt, maxTokens, temperature, options};
    return { text: JSON.stringify({ personas: "Synthetic persona", competitors: [], content_summary: "Synthetic content" }),
      stopReason: "end_turn", inputTokens: 10, outputTokens: 20 };
  }
  export async function callLLM(...args) { return (await callLLMDetailed(...args)).text; }`,
  "../lib/llm-preflight.js": `export async function checkLlmReady() {
    const state = globalThis.__prefillExclusionTest;
    state.preflights = (state.preflights ?? 0) + 1;
    return state.readiness ?? {ok: true, provider: "claude"};
  }`,
  "../lib/prompt-manager.js": `export async function getPrompt() { return "Synthetic prompt"; } export const fillTemplate = template => template;`,
  "../lib/admin-db.js": `export async function getSetting() { return "ai"; }`,
  "../lib/competitor-sources.js": `export async function findCandidatesBySearch() { throw new Error("Unexpected search"); }`,
  "../lib/crawl-exclusion-store.js": `
    export const CRAWL_EXCLUSION_LOAD_ERROR = "Die Ausschlussliste für den Crawl konnte nicht geladen werden. Bitte versuchen Sie es später erneut.";
    export async function getCrawlExclusionRules() {
      const state = globalThis.__prefillExclusionTest;
      state.loads++;
      if (state.error) throw state.error;
      return state.matcher;
    }
  `,
  "../lib/logger": `export const logger = Object.fromEntries(["info", "warn", "error"].map(level => [
    level, (obj, msg) => globalThis.__prefillExclusionTest.logs.push({ level, obj, msg })
  ]));`,
};
const { outputFiles } = await build({
  stdin: {
    contents: `export { default } from "./prefill.ts";
      export { compileExclusionRules } from "../lib/crawl-exclusions.ts";
      export { CRAWL_EXCLUSION_SEED } from "../lib/crawl-exclusion-seed.ts";`,
    resolveDir: new URL(".", import.meta.url).pathname, loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "prefill-exclusion-mocks",
    setup(builder) {
      builder.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: "prefill-test" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "prefill-test" }, args => ({ contents: mocks[args.path], loader: "js" }));
    },
  }],
});
const { compileExclusionRules, CRAWL_EXCLUSION_SEED } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);
state.matcher = compileExclusionRules(CRAWL_EXCLUSION_SEED.map(rule => ({ ...rule, is_active: true })));

async function request(body = { company_name: "Synthetic company", url: "https://example.test/" }) {
  const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await state.handlers.get("/prefill")({ body }, response);
  return response;
}

test("prefill rule-load failure returns the German error without crawling or calling AI", async () => {
  state.error = new Error("synthetic DB outage");
  state.loads = 0; state.aiCalls = 0; state.logs = [];
  const before = globalThis.fetch;
  globalThis.fetch = () => { assert.fail("fetch must not happen after rule-load failure"); };
  try {
    const response = await request();
    assert.equal(response.code, 500);
    assert.deepEqual(response.body, { error: "Die Ausschlussliste für den Crawl konnte nicht geladen werden. Bitte versuchen Sie es später erneut." });
    assert.equal(state.loads, 1);
    assert.equal(state.aiCalls, 0);
    assert.ok(state.logs.some(log => log.level === "warn" && log.obj.reason === "synthetic DB outage"));
  } finally { globalThis.fetch = before; delete state.error; }
});

test("prefill loads once and uses the full seed list rather than its former shorter list", async () => {
  state.loads = 0; state.requests = []; state.aiCalls = 0;
  const before = globalThis.fetch;
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    state.requests.push(path);
    return new Response(path === "/"
      ? '<html lang="de"><body>Die Produkte und Leistungen sind für unsere Kunden wichtig.<a href="/newsletter">Newsletter</a><a href="/shipping">Shipping</a><a href="/products">Produkte</a><a href="/utm_source">Tracking</a></body></html>'
      : "<html><body>Synthetic product information</body></html>", { headers: { "content-type": "text/html" } });
  };
  try {
    const response = await request();
    assert.equal(response.code, 200);
    assert.equal(state.loads, 1);
    assert.deepEqual(state.requests, ["/", "/products"]);
    assert.equal(state.aiCalls, 1);
    assert.deepEqual(state.lastAiCall, {
      prompt: "Synthetic prompt", maxTokens: 1500, temperature: 0,
      options: { module: "prefill-main", timeoutMs: 90_000, maxRetries: 1 },
    });
  } finally { globalThis.fetch = before; }
});

test("failed preflight returns 503 and the code without loading exclusions, crawling or starting prefill", async () => {
  state.readiness = {ok:false,provider:"openai",reason:"provider_error",status:429};
  state.loads=0; state.aiCalls=0; state.preflights=0; state.logs=[];
  const before=globalThis.fetch;
  globalThis.fetch=()=>assert.fail("crawl forbidden after failed preflight");
  try {
    const response=await request();
    assert.equal(response.code,503);
    assert.deepEqual(response.body,{error:"LLM provider unavailable",code:"LLM_UNAVAILABLE"});
    assert.equal(state.preflights,1);
    assert.equal(state.loads,0);
    assert.equal(state.aiCalls,0);
    assert.ok(state.logs.some(log=>log.level==="warn" && log.msg==="prefill blocked: llm preflight failed"
      && log.obj.reason==="provider_error" && log.obj.provider==="openai" && log.obj.status===429));
  } finally {globalThis.fetch=before;delete state.readiness;}
});

test("400 input validation precedes readiness checks",async()=>{
  state.preflights=0;state.loads=0;state.aiCalls=0;
  const response=await request({company_name:"",url:""});
  assert.equal(response.code,400);
  assert.equal(state.preflights,0);
  assert.equal(state.loads,0);
  assert.equal(state.aiCalls,0);
});
