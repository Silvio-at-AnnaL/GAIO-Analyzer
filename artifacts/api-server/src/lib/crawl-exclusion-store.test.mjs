import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

let instance = 0;
async function load(state) {
  globalThis.__crawlExclusionStoreTest = state;
  const mocks = {
    "./db.js": `export async function query(sql) {
      const state = globalThis.__crawlExclusionStoreTest;
      state.calls++;
      state.sql = sql;
      if (state.error) throw state.error;
      if (state.wait) await state.wait;
      return { rows: state.rows.map(row => ({ ...row })) };
    }`,
    "./logger.js": `export const logger = Object.fromEntries(["info", "warn"].map(level => [
      level, (obj, msg) => globalThis.__crawlExclusionStoreTest.logs.push({ level, obj, msg })
    ]));`,
  };
  const { outputFiles } = await build({
    stdin: {
      contents: `export * from "./crawl-exclusion-store.ts"; export const testInstance = ${++instance};`,
      resolveDir: new URL(".", import.meta.url).pathname, loader: "ts",
    },
    bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{
      name: "crawl-rule-store-mocks",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
          ? { path: args.path, namespace: "store-test" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "store-test" }, args => ({ contents: mocks[args.path], loader: "js" }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}
const row = (pattern, is_active = true) => ({ pattern, is_active, count_in_report: true });

test("cold DB error throws instead of crawling unfiltered", async () => {
  const state = { calls: 0, rows: [], logs: [], error: new Error("synthetic database failure") };
  const { getCrawlExclusionRules } = await load(state);
  await assert.rejects(getCrawlExclusionRules(), /synthetic database failure/);
  assert.ok(!state.logs.some(log => log.msg === "crawl exclusion rules: using cached rules"));
});

test("60-second cache compiles once; expiry and invalidation reload; failures retain the last snapshot", async () => {
  const state = { calls: 0, rows: [row("account"), row("cart", false)], logs: [] };
  const { getCrawlExclusionRules, invalidateCrawlExclusionCache } = await load(state);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const first = await getCrawlExclusionRules();
    assert.equal(first.isExcluded("https://example.test/account"), true);
    assert.equal(first.isExcluded("https://example.test/cart"), false);
    assert.ok(!state.sql.includes("WHERE"), "active and inactive rows must both be loaded");
    now += 59_999;
    assert.equal(await getCrawlExclusionRules(), first);
    assert.equal(state.calls, 1);
    now++;
    state.rows = [row("shipping")];
    const second = await getCrawlExclusionRules();
    assert.notEqual(second, first);
    assert.equal(first.isExcluded("https://example.test/account"), true, "analysis snapshot must stay immutable");
    assert.equal(second.isExcluded("https://example.test/shipping"), true);
    assert.equal(state.calls, 2);
    invalidateCrawlExclusionCache();
    state.error = new Error("synthetic outage");
    assert.equal(await getCrawlExclusionRules(), second);
    assert.ok(state.logs.some(log => log.level === "warn" && log.msg === "crawl exclusion rules: using cached rules"));
    delete state.error;
    state.rows = [];
    const empty = await getCrawlExclusionRules();
    assert.equal(empty.isExcluded("https://example.test/shipping"), false);
    assert.equal(state.calls, 4);
    assert.ok(state.logs.some(log => log.msg === "crawl exclusion rules loaded" &&
      log.obj.total === 2 && log.obj.active === 1 && log.obj.source === "db"));
    assert.ok(state.logs.some(log => log.obj.source === "cache"));
  } finally { Date.now = originalNow; }
});

test("concurrent callers share one in-flight load and receive the same compiled matcher", async () => {
  let release;
  const state = { calls: 0, rows: [row("account")], logs: [], wait: new Promise(resolve => { release = resolve; }) };
  const { getCrawlExclusionRules } = await load(state);
  const a = getCrawlExclusionRules(), b = getCrawlExclusionRules();
  release();
  assert.equal(await a, await b);
  assert.equal(state.calls, 1);
});

test("invalidation during a load prevents the stale request from refilling the cache", async () => {
  let release;
  const state = { calls: 0, rows: [row("account")], logs: [], wait: new Promise(resolve => { release = resolve; }) };
  const { getCrawlExclusionRules, invalidateCrawlExclusionCache } = await load(state);
  const first = getCrawlExclusionRules();
  invalidateCrawlExclusionCache();
  release();
  await first;
  delete state.wait;
  state.rows = [row("shipping")];
  const current = await getCrawlExclusionRules();
  assert.equal(current.isExcluded("https://example.test/shipping"), true);
  assert.equal(state.calls, 2);
});
