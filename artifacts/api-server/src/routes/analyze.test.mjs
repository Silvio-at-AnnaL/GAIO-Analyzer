import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  express: `
    export function Router() {
      const routes = new Map();
      const router = {
        post(path, ...handlers) { routes.set("POST " + path, handlers); return router; },
        get(path, ...handlers) { routes.set("GET " + path, handlers); return router; },
      };
      globalThis.__analyzeTestRoutes = routes;
      return router;
    }
  `,
  uuid: `export const v4 = () => "test-analysis-id";`,
  "@workspace/api-zod": `
    export const StartAnalysisBody = { safeParse: (body) => ({ success: true, data: body }) };
    export const GetAnalysisReportParams = { safeParse: (params) => ({ success: true, data: params }) };
  `,
  "../lib/analysis-engine": `
    export function runAnalysis(...args) { globalThis.__analyzeTest.runs.push(args); }
    export function getAnalysis() { return null; }
  `,
  "../lib/llm-preflight.js": `
    export async function checkLlmReady() {
      globalThis.__analyzeTest.preflightCalls++;
      return globalThis.__analyzeTest.readiness;
    }
  `,
};

const { outputFiles } = await build({
  entryPoints: [new URL("./analyze.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "analyze-route-mocks",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) =>
        Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "analyze-mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "analyze-mock" }, (args) => ({
        contents: mocks[args.path],
        loader: "js",
      }));
    },
  }],
});
await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

function reset(readiness) {
  globalThis.__analyzeTest = { readiness, runs: [], preflightCalls: 0, logs: [] };
  return globalThis.__analyzeTest;
}

async function postAnalyze(body = {}) {
  const handlers = globalThis.__analyzeTestRoutes.get("POST /analyze");
  const req = {
    body: { mode: "url", url: "https://example.test", questionnaire: {}, explicitUrls: [], ...body },
    ip: "127.0.0.1",
    log: { warn: (obj, msg) => globalThis.__analyzeTest.logs.push({ obj, msg }) },
  };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handlers.at(-1)(req, res);
  return res;
}

test("does not register the analysis list but preserves anonymous result and event routes", () => {
  const routes = globalThis.__analyzeTestRoutes;
  assert.equal(routes.has("GET /analyses"), false);
  assert.equal(routes.has("GET /analyze/:id"), true);
  assert.equal(routes.has("GET /analyze/:id/events"), true);
});

test("failed LLM preflight responds 503 and does not start analysis", async () => {
  const state = reset({ ok: false, provider: "claude", reason: "provider_error", status: 503 });
  const res = await postAnalyze();
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "LLM provider unavailable", code: "LLM_UNAVAILABLE" });
  assert.equal(state.preflightCalls, 1);
  assert.equal(state.runs.length, 0);
  assert.deepEqual(state.logs, [{
    obj: { reason: "provider_error", provider: "claude", status: 503 },
    msg: "analysis blocked: llm preflight failed",
  }]);
});

test("successful LLM preflight preserves the 201 running response", async () => {
  const state = reset({ ok: true, provider: "claude" });
  const res = await postAnalyze();
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { id: "test-analysis-id", status: "running" });
  assert.equal(state.preflightCalls, 1);
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0][0], "test-analysis-id");
});

test("fill fields are ignored without selected pages, in HTML mode, or without opt-in", async () => {
  for (const body of [
    { explicitUrls: [] },
    { mode: "html", html: "<html></html>", explicitUrls: ["https://example.test/a"] },
    { explicitUrls: ["https://example.test/a"], fillToMax: false },
  ]) {
    const state = reset({ ok: true });
    await postAnalyze({ fillToMax: true, excludedUrls: ["https://example.test/b"], ...body });
    assert.equal(state.runs[0][7], undefined);
  }
});

test("fill opt-in forwards exclusions capped at 200 without altering the selected pages", async () => {
  const state = reset({ ok: true });
  const explicitUrls = ["https://example.test/a"];
  const excludedUrls = Array.from({ length: 220 }, (_, index) => `https://example.test/excluded-${index}`);
  await postAnalyze({ explicitUrls, fillToMax: true, excludedUrls });
  assert.deepEqual(state.runs[0][5], explicitUrls);
  assert.deepEqual(state.runs[0][7], { fillToMax: true, excludedUrls: excludedUrls.slice(0, 200) });
});