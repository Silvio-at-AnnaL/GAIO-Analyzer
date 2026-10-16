import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Run the actual route SQL against read-only VALUES fixtures, never the ledger.
const require = createRequire(new URL("../../package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 8000,
});
after(() => pool.end());
const mocks = {
  "../lib/db.js": "export const query=(sql,params)=>globalThis.__usageSummaryQuery(sql,params);",
  "../lib/admin-db.js": "export const getSetting=async key=>key==='search_included_credits'?'1000':'free';",
  "../lib/logger.js": "export const logger={error(){}};",
};
const { outputFiles } = await build({
  entryPoints: [new URL("./usage.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "summary-fixtures", setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
      ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js" }));
  } }],
});
const { registerUsageRoutes } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const fixture = `WITH usage_events(created_at,env,kind,area,module,model,analysis_id,input_tokens,output_tokens,search_credits,cost_usd) AS (VALUES
  ('2026-10-15T21:30:00Z'::timestamptz,'live','llm','analysis','content-relevance','claude','a',100,20,0,0.10::numeric),
  ('2026-10-15T22:30:00Z'::timestamptz,'live','llm','analysis','content-relevance','claude','b',200,40,0,0.20::numeric),
  ('2026-10-15T22:31:00Z'::timestamptz,'live','llm','analysis','content-relevance','claude','b',300,60,0,0.30::numeric),
  ('2026-10-15T22:32:00Z'::timestamptz,'live','llm','preparation','prefill-main','claude',NULL,50,10,0,0.05::numeric),
  ('2026-10-15T22:33:00Z'::timestamptz,'live','search','preparation','competitor-search',NULL,NULL,0,0,3,0.03::numeric),
  ('2026-10-15T22:34:00Z'::timestamptz,'live','search','system','preflight',NULL,'search-only',0,0,2,NULL::numeric),
  ('2026-10-15T22:35:00Z'::timestamptz,'dev','llm','analysis','faq-quality','other','c',10,2,0,0.01::numeric),
  ('2026-10-25T21:30:00Z'::timestamptz,'live','llm','analysis','content-relevance','claude','d',100,20,0,0.10::numeric),
  ('2026-10-25T23:30:00Z'::timestamptz,'live','llm','analysis','content-relevance','claude','e',200,40,0,0.20::numeric)
) `;

async function summary(query) {
  globalThis.__usageSummaryQuery = (sql, params) => pool.query(fixture + sql, params);
  const routes = {};
  registerUsageRoutes({ get(path, ...handlers) { routes[path] = handlers; } }, () => {}, () => {});
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };
  await routes["/usage/summary"].at(-1)({ query }, response);
  assert.equal(response.statusCode, 200);
  return response.body;
}

test("summary groups retain calls and add distinct LLM/search counts and summed credits", async () => {
  const data = await summary({ from: "2026-10-16", to: "2026-10-16", env: "live" });
  for (const [rows, key, id] of [[data.byArea, "area", "preparation"], [data.byModel, "model", "claude"]]) {
    const row = rows.find(row => row[key] === id);
    assert.equal(row.calls, row.llmCalls + row.searchCalls);
    assert.equal(typeof row.searchCredits, "number");
  }
  assert.deepEqual(data.byArea.find(row => row.area === "preparation"), {
    area: "preparation", calls: 2, llmCalls: 1, searchCalls: 1,
    inputTokens: 50, outputTokens: 10, searchCredits: 3, costUsd: 0.08,
  });
  assert.deepEqual(data.byModule.find(row => row.module === "competitor-search"), {
    module: "competitor-search", calls: 1, llmCalls: 0, searchCalls: 1,
    inputTokens: 0, outputTokens: 0, searchCredits: 3, costUsd: 0.03,
  });
  assert.deepEqual(data.byModel.find(row => row.model === null), {
    model: null, calls: 2, llmCalls: 0, searchCalls: 2,
    inputTokens: 0, outputTokens: 0, searchCredits: 5, costUsd: 0.03,
  });
  assert.equal(data.byArea.find(row => row.area === "system").costUsd, null);
});

test("byDay groups 23:30/00:30 Berlin on different days and counts distinct LLM analyses only", async () => {
  const data = await summary({ from: "2026-10-15", to: "2026-10-16", env: "live" });
  assert.deepEqual(data.byDay, [
    { day: "2026-10-15", costUsd: 0.1, inputTokens: 100, outputTokens: 20, searchCredits: 0, analyses: 1 },
    { day: "2026-10-16", costUsd: 0.55, inputTokens: 550, outputTokens: 110, searchCredits: 5, analyses: 1 },
  ]);
  assert.equal(data.totals.costUsd, 0.65);
  assert.equal(data.totals.searchCostUsd, 0.03);
  assert.equal(data.analysesCount, 2);
});

test("whole Berlin-day filtering excludes the previous evening and respects environment", async () => {
  const live = await summary({ from: "2026-10-16", to: "2026-10-16" });
  const dev = await summary({ from: "2026-10-16", to: "2026-10-16", env: "dev" });
  const all = await summary({ from: "2026-10-16", to: "2026-10-16", env: "all" });
  assert.equal(live.byDay[0].costUsd, 0.55);
  assert.deepEqual(dev.byDay, [{ day: "2026-10-16", costUsd: 0.01, inputTokens: 10, outputTokens: 2, searchCredits: 0, analyses: 1 }]);
  assert.equal(all.byDay[0].costUsd, 0.56);
  assert.equal(all.byDay[0].analyses, 2);
});

test("Berlin day grouping also respects standard time after the DST transition", async () => {
  const data = await summary({ from: "2026-10-25", to: "2026-10-26", env: "live" });
  assert.deepEqual(data.byDay.map(row => [row.day, row.costUsd]), [
    ["2026-10-25", 0.1], ["2026-10-26", 0.2],
  ]);
});

test("an empty period retains null costs, zero counts and empty breakdowns", async () => {
  const data = await summary({ from: "2025-01-01", to: "2025-01-02", env: "all" });
  assert.equal(data.totals.costUsd, null);
  assert.equal(data.analysesCount, 0);
  assert.equal(data.avgCostPerAnalysis, null);
  for (const key of ["byArea", "byModule", "byModel", "byDay"]) assert.deepEqual(data[key], []);
});
