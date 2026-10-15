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
  "@workspace/integrations-anthropic-ai": `export const anthropic = { messages: { async create(params) {
    const s = globalThis.__prefillContextTest;
    const prompt = params.messages[0].content;
    s.prompts.push(prompt);
    if (prompt.startsWith("RELEVANCE:")) return { content: [{type:"text", text:
      [1,2].map(n => "KANDIDAT: " + n + "\\nPASST: ja\\nGRUND: Passender Hersteller\\nDUBLETTE_VON: -").join("\\n\\n") }] };
    return { content: [{type:"text", text:JSON.stringify(s.initial)}] };
  } } };`,
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
    })
  ]));`,
};
const { outputFiles } = await build({
  entryPoints: [new URL("./prefill.ts", import.meta.url).pathname],
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
await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

async function run({ failed = false, summary = null, companyContext = null, source = "search", longCrawl = false, blockedCandidate = false } = {}) {
  Object.assign(state, {
    initial: { personas: "Technische Einkäufer", competitors: [aiCandidate], content_summary: summary, company_context: companyContext },
    source, searches: [], prompts: [], logs: [], searchCandidates,
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
    await state.handlers.get("/prefill")({body:{company_name:"Firma Test",url:"https://company.test/"}}, response);
    assert.equal(response.code, 200);
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
