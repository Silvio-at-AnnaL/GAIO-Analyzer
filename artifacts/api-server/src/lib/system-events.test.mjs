import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./db.js": "export async function query(sql, params) { globalThis.__persistedSystemEventQueries?.push({sql,params}); }",
  "./logger.js": "export function setLogSink(sink) { globalThis.__testSystemEventSink = sink; }",
};

const { outputFiles } = await build({
  entryPoints: [new URL("./system-events.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "mock-system-events-imports",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) =>
        Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "system-events-mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "system-events-mock" }, (args) => ({
        contents: mocks[args.path],
        loader: "js",
      }));
    },
  }],
});
const { buildContext, isSensitiveKey, shouldPersist, PERSISTED_INFO_MESSAGES, initSystemEventLog } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

test("both correlation IDs stay in their columns, not duplicated into event context", () => {
  assert.equal(buildContext({ analysisId: "analysis", prepId: "prep" }), null);
  assert.deepEqual(buildContext({ prepId: "prep", provider: "claude" }), { provider: "claude" });
});

test("event persistence binds prep_id separately in every buffered SQL row", async () => {
  const calls = globalThis.__persistedSystemEventQueries = [];
  initSystemEventLog();
  const receive = globalThis.__testSystemEventSink;
  receive({ level: 30, msg: "callLLM route", obj: { prepId: "prep", provider: "claude" } });
  for (let i = 0; i < 49; i++) {
    receive({ level: 30, msg: "callLLM route", obj: { analysisId: "analysis", prepId: "prep" } });
  }
  await new Promise(resolve => setImmediate(resolve));
  const insert = calls.find(call => call.sql.includes("INSERT INTO system_events"));
  assert.match(insert.sql, /\(level, msg, analysis_id, context, prep_id\)/);
  assert.equal(insert.params.length, 250);
  assert.deepEqual(insert.params.slice(0, 10), [
    30, "callLLM route", null, { provider: "claude" }, "prep",
    30, "callLLM route", "analysis", null, "prep",
  ]);
  assert.match(insert.sql, /\(\$6, \$7, \$8, \$9::jsonb, \$10\)/);
});

test("redirect category learning INFO persists with its diagnostic fields", () => {
  const msg = "category skipped: redirects to known page";
  const obj = { category: "product_type", redirectDuplicates: 2, dropped: 23,
    example: { url: "https://example.test/product_type/one", finalUrl: "https://example.test/" } };
  assert.ok(PERSISTED_INFO_MESSAGES.has(msg));
  assert.equal(shouldPersist({ level: 30, msg, obj }), true);
  assert.deepEqual(buildContext(obj), obj);
});

test("crawl exclusion snapshot load INFO is persisted", () => {
  assert.ok(PERSISTED_INFO_MESSAGES.has("crawl exclusion rules loaded"));
  assert.equal(shouldPersist({ level: 30, msg: "crawl exclusion rules loaded", obj: {} }), true);
});

test("competitor search queries and missing-context skip are persisted at info level", () => {
  const queries = ["Hochdruckpumpen Anbieter Deutschland", "Wasserstrahltechnik Hersteller DACH"];
  for (const msg of ["Prefill: competitor search queries", "competitor search skipped: no company context"]) {
    assert.ok(PERSISTED_INFO_MESSAGES.has(msg));
    assert.equal(shouldPersist({ level: 30, msg, obj: { queries } }), true);
  }
  assert.deepEqual(buildContext({ queries }), { queries });
});
test("transient server errors WARN is persisted with its aggregate counts and status groups", () => {
  const obj = { transientErrors: 3, recoveredAfterRetry: 2, attempted: 16, byStatus: { 502: 2, timeout: 1 } };
  assert.equal(shouldPersist({ level: 40, msg: "transient server errors", obj }), true);
  const context = buildContext(obj);
  assert.ok(JSON.stringify(context).includes("recoveredAfterRetry"));
  assert.ok(JSON.stringify(context).includes("502"));
});
test("retry budget exhaustion INFO is persisted with the crawl host and exhausted URL count", () => {
  assert.ok(PERSISTED_INFO_MESSAGES.has("retry budget exhausted"));
  assert.equal(shouldPersist({ level: 30, msg: "retry budget exhausted", obj: { host: "example.test", exhaustedUrls: 3 } }), true);
  const context = buildContext({ host: "example.test", exhaustedUrls: 3 });
  assert.equal(context.host, "example.test");
  assert.equal(context.exhaustedUrls, 3);
});

test("crawl exclusion mutation audit INFO is persisted", () => {
  assert.ok(PERSISTED_INFO_MESSAGES.has("crawl exclusion rule changed"));
  assert.equal(shouldPersist({ level: 30, msg: "crawl exclusion rule changed", obj: {} }), true);
});

test("isSensitiveKey recognizes sensitive words and API key forms", () => {
  for (const key of [
    "password", "passwordHash", "apiKey", "api_key", "API_KEY", "APIKey", "x-api-key",
    "apikey", "accessToken", "refresh_token", "clientSecret", "authorization", "cookie", "setCookie",
  ]) {
    assert.equal(isSensitiveKey(key), true, `${key} should be sensitive`);
  }
});

test("site language determined persists at info level with hostname and language metadata", () => {
  const obj = {
    host: "example.test",
    siteLanguage: { lang: "de", source: "content", declared: "en", mismatch: true },
    switched: true, readmittedPages: 2,
  };
  assert.ok(PERSISTED_INFO_MESSAGES.has("site language determined"));
  assert.equal(shouldPersist({ level: 30, msg: "site language determined", obj }), true);
  assert.equal(shouldPersist({ level: 20, msg: "site language determined", obj }), false);
  assert.equal(shouldPersist({ level: 30, msg: "unlisted info message", obj }), false);
  assert.deepEqual(buildContext(obj), obj);
});

test("isSensitiveKey does not redact unrelated or near-match words", () => {
  for (const key of [
    "passages", "passageUrls", "passt", "bypass", "compass", "inputTokens",
    "excludedTerms", "pageCount",
  ]) {
    assert.equal(isSensitiveKey(key), false, `${key} should not be sensitive`);
  }
});

test("language variant selected persists at info level without redacting variant metadata", () => {
  const obj = { host: "example.test", from: "https://example.test/", to: "https://example.test/de/", fromLang: "en", toLang: "de" };
  assert.ok(PERSISTED_INFO_MESSAGES.has("language variant selected"));
  assert.equal(shouldPersist({ level: 30, msg: "language variant selected", obj }), true);
  assert.equal(shouldPersist({ level: 20, msg: "language variant selected", obj }), false);
  assert.deepEqual(buildContext(obj), obj);
});

test("buildContext keeps nested passages readable", () => {
  const context = buildContext({
    questions: [{
      id: "question-1",
      passages: [{ url: "https://example.com/page", score: 0.82 }],
    }],
  });
  assert.deepEqual(context, {
    questions: [{
      id: "question-1",
      passages: [{ url: "https://example.com/page", score: 0.82 }],
    }],
  });
});

test("buildContext still redacts API keys and preserves primitive values", () => {
  assert.deepEqual(buildContext({ apiKey: "sk-secret-value" }), { apiKey: "[redacted]" });
  assert.deepEqual(buildContext({
    password: null,
    apiKey: 123,
    token: false,
  }), {
    password: null,
    apiKey: 123,
    token: false,
  });
});