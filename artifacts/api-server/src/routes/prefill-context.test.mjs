import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const state = { handlers: new Map(), initial: {}, source: "search", searches: [], prompts: [], logs: [] };
globalThis.__prefillContextTest = state;
const aiCandidate = { name: "AI Hersteller", url: "https://ai-candidate.test", reason: "Direkter Wettbewerber" };
const searchCandidates = [1, 2].map(n => ({ name: `Suchhersteller ${n}`, url: `https://search-${n}.test`, reason: "Direkter Wettbewerber" }));
const mocks = {
  express: `export function Router() { return { post(path, fn) { globalThis.__prefillContextTest.handlers.set(path, fn); } }; }`,
  "../lib/ai-client.js": `export async function callLLM(prompt, maxTokens, temperature, options) {
    const s = globalThis.__prefillContextTest;
    s.prompts.push(prompt);
    s.aiCalls.push({prompt,maxTokens,temperature,options});
    if (prompt.startsWith("RELEVANCE:")) return [1,2].map(n =>
      "KANDIDAT: " + n + "\\nPASST: ja\\nGRUND: Passender Hersteller\\nDUBLETTE_VON: -").join("\\n\\n");
    return s.rawResponse ?? JSON.stringify(s.initial);
  }
  export async function callLLMDetailed(...args) {
    return {text:await callLLM(...args),stopReason:"max_tokens",inputTokens:10,outputTokens:20};
  }`,
  "../lib/llm-preflight.js": `export async function checkLlmReady() {return {ok:true,provider:"claude"};}`,
  "../lib/prompt-manager.js": `export async function getPrompt(slug) {
    if(slug === "competitor-relevance") return "RELEVANCE:{{COMPANY_SUMMARY}}";
    return "STORED:{{CRAWLED_CONTENT}}";
  }
  export function fillTemplate(template, vars) {
    return Object.entries(vars).reduce((text, [key, val]) => text.replaceAll("{{"+key+"}}", val), template);
  }`,
  "../lib/admin-db.js": `export async function getSetting(key) {
    if(key !== "competitor_source") throw Error("Unexpected setting: " + key);
    return globalThis.__prefillContextTest.source;
  }`,
  "../lib/competitor-sources.js": `export async function findCandidatesBySearch(...args) {
    const s = globalThis.__prefillContextTest; s.searches.push(args);
    return {candidates:s.searchCandidates, queries:["synthetic query"]};
  }`,
  "../lib/crawl-exclusion-store.js": `export const CRAWL_EXCLUSION_LOAD_ERROR = "not used";
    export async function getCrawlExclusionRules() { return {isExcluded:()=>false}; }`,
  "../lib/logger": `export const logger = Object.fromEntries(["info","warn","error"].map(level => [
    level, (obj, msg) => globalThis.__prefillContextTest.logs.push({
      level, msg: typeof obj === "string" ? obj : msg, obj: typeof obj === "string" ? {} : obj,
      prepId: globalThis.__prefillLogPrepId?.(),
    })
  ]));`,
};
const { outputFiles } = await build({
  stdin: {
    contents: 'import "./prefill.ts"; export { getPrepId } from "../lib/log-context.js";',
    resolveDir: new URL(".", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "prefill-context",
    setup(b) {
      b.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
      b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
    },
  }],
});
const logContext = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
globalThis.__prefillLogPrepId = logContext.getPrepId;

async function run({ failed = false, summary = null, companyContext = null, source = "search", longCrawl = false, blockedCandidate = false, rawResponse, expectedStatus = 200, prepId } = {}) {
  Object.assign(state, {
    initial: { personas: "Technische Einkäufer", competitors: [aiCandidate], content_summary: summary, company_context: companyContext },
    source, searches: [], prompts: [], logs: [], searchCandidates, aiCalls: [], rawResponse,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (new URL(url).hostname === "company.test") {
      return failed ? new Response("Forbidden", {status:403})
        : new Response(`<html lang="de"><body><main>${longCrawl
          ? "Gecrawlte Produkte für industrielle Anwendungen. ".repeat(50) + '<a href="/products">Produkte</a>'
          : "Gecrawlte Produkte für industrielle Anwendungen."}</main></body></html>`);
    }
    if (blockedCandidate) return new Response("<html><title>Just a moment...</title><body>Cloudflare checking your browser</body></html>", {status:403});
    return new Response(`<html><body><main>${"Dieser Hersteller produziert passende industrielle Produkte und liefert an technische Einkäufer. ".repeat(3)}</main></body></html>`);
  };
  const response = { body: null, code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  try {
    await state.handlers.get("/prefill")({body:{company_name:"Firma Test",url:"https://company.test/",prep_id:prepId}}, response);
    assert.equal(response.code, expectedStatus);
    return response.body;
  } finally { globalThis.fetch = originalFetch; }
}

test("content_summary takes priority for search and relevance; successful prompt remains stored", async () => {
  const data = await run({ summary: "Website-Zusammenfassung", companyContext: "Ignored general knowledge" });
  assert.equal(state.searches[0][0], "Website-Zusammenfassung");
  assert.ok(state.prompts.includes("RELEVANCE:Website-Zusammenfassung"));
  assert.match(state.prompts[0], /^STORED:/);
  assert.ok(!state.prompts[0].includes("company_context"));
  assert.equal(data.content_summary, "Website-Zusammenfassung");
  assert.equal(data.candidateSource, "search");
  assert.equal(data.competitors.length, 2);
});

test("valid prefill prep_id covers every handler log and invalid IDs are silently ignored", async () => {
  const id = "ABCDEFAB-1234-7BCD-ABCD-ABCDEFABCDEF";
  await run({ summary: "Content", prepId: id });
  assert.ok(state.logs.length > 0);
  assert.ok(state.logs.every(log => log.prepId === id.toLowerCase()));
  for (const prepId of ["invalid", 123, null]) {
    await run({ summary: "Content", prepId });
    assert.ok(state.logs.every(log => log.prepId === undefined));
  }
});

test("successful crawl without summary uses the existing first 1600 crawled characters for search and relevance", async () => {
  const data = await run({ summary: "  ", companyContext: "Must not be used on successful crawl", longCrawl: true });
  const context = state.searches[0][0];
  const crawled = state.prompts[0].slice("STORED:".length);
  assert.ok(crawled.length > 1600);
  assert.equal(context.length, 1600);
  assert.equal(context, crawled.slice(0, 1600));
  assert.ok(context.includes("Gecrawlte Produkte"));
  assert.ok(state.prompts.includes(`RELEVANCE:${context}`));
  assert.equal(data.content_summary, null);
  assert.ok(!JSON.stringify(data).includes("Must not be used"));
});

test("failed crawl uses company_context internally but never exposes it as website content", async () => {
  const data = await run({ failed: true, companyContext: "**Hochdruckpumpen für die Industrie.**" });
  assert.equal(state.searches[0][0], "Hochdruckpumpen für die Industrie.");
  assert.ok(state.prompts.includes("RELEVANCE:Hochdruckpumpen für die Industrie."));
  assert.equal(data.content_summary, null);
  assert.ok(!Object.hasOwn(data, "company_context"));
  assert.ok(!JSON.stringify(data).includes("Hochdruckpumpen"));
  assert.equal(data.candidateSource, "search");
});

test("no context skips search, retains AI candidates and checks relevance using name plus personas", async () => {
  const data = await run({ failed: true });
  assert.equal(state.searches.length, 0);
  assert.ok(state.logs.some(log => log.level === "info" && log.msg === "competitor search skipped: no company context"));
  assert.ok(state.prompts.includes("RELEVANCE:Firma Test\nTechnische Einkäufer"));
  assert.equal(data.candidateSource, "ai");
  assert.equal(data.competitors.length, 1);
  assert.equal(data.competitors[0].url, aiCandidate.url);
});

test("failed prompt requests confident general knowledge separately and keeps content_summary null", async () => {
  const data = await run({ failed: true, summary: "Untrusted invented website content", companyContext: " " });
  assert.match(state.prompts[0], /"company_context":/);
  assert.match(state.prompts[0], /2-3 sentences in German/);
  assert.match(state.prompts[0], /Use null if you do not know the company with confidence/);
  assert.match(state.prompts[0], /"content_summary": null/);
  assert.equal(data.content_summary, null);
  assert.equal(state.searches.length, 0);
  assert.ok(state.prompts.includes("RELEVANCE:Firma Test\nTechnische Einkäufer"));
});

test("AI source stays AI and uses failed-crawl context only for relevance", async () => {
  const data = await run({ failed: true, companyContext: "Fachlicher Firmenkontext", source: "ai" });
  assert.equal(state.searches.length, 0);
  assert.equal(data.candidateSource, "ai");
  assert.ok(state.prompts.includes("RELEVANCE:Fachlicher Firmenkontext"));
  assert.ok(!state.logs.some(log => log.msg === "competitor search skipped: no company context"));
});

test("the obsolete placeholder is absent from production route and source code", async () => {
  for (const path of ["./prefill.ts", "../lib/competitor-sources.ts"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.ok(!source.includes("Kein auswertbarer Text der Unternehmenswebsite vorhanden."));
  }
});

test("judged search candidate exposes the clean relevance reason instead of the search snippet", async () => {
  const data = await run({ summary: "Website-Zusammenfassung" });
  assert.ok(data.competitors.every(c => c.reason === "Passender Hersteller"));
});

test("unjudged blocked candidate retains its original search reason", async () => {
  const data = await run({ summary: "Website-Zusammenfassung", blockedCandidate: true });
  assert.equal(data.competitors.length, 2);
  assert.ok(data.competitors.every(c => c.reason === "Direkter Wettbewerber"));
  assert.ok(state.prompts.every(prompt => !prompt.startsWith("RELEVANCE:")));
});

test("main, URL correction, replacement and relevance calls use their exact central options and temperature zero",async()=>{
  await run({summary:"Website-Zusammenfassung",blockedCandidate:true});
  const expected={
    "prefill-main":{maxTokens:1500,timeoutMs:90_000,maxRetries:1},
    "prefill-url-correction":{maxTokens:100,timeoutMs:30_000,maxRetries:1},
    "prefill-replacement":{maxTokens:220,timeoutMs:30_000,maxRetries:1},
    "prefill-relevance":{maxTokens:1500,timeoutMs:30_000,maxRetries:2},
  };
  const calls=[...state.aiCalls];
  await run({summary:"Website-Zusammenfassung"});
  calls.push(...state.aiCalls);
  assert.deepEqual([...new Set(calls.map(c=>c.options.module))].sort(),Object.keys(expected).sort());
  for(const call of calls) {
    const {maxTokens,...options}=expected[call.options.module];
    assert.equal(call.maxTokens,maxTokens);
    assert.equal(call.temperature,0);
    assert.deepEqual(call.options,{module:call.options.module,...options});
  }
});

for(const [rawResponse,message,error] of [
  ["no JSON here","Prefill: no JSON found in AI response","AI returned an unexpected format"],
  ['{"personas":invalid}',"Prefill: failed to parse JSON","Failed to parse AI response"],
]) {
  test(`${message} logs the detailed stop reason and retains the existing response`,async()=>{
    const data=await run({rawResponse,expectedStatus:500});
    assert.deepEqual(data,{error});
    assert.ok(state.logs.some(log=>log.level==="error" && log.msg===message && log.obj.stopReason==="max_tokens"));
  });
}
