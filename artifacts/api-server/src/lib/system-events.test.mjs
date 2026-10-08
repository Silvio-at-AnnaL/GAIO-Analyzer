import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./db.js": "export async function query() {}",
  "./logger.js": "export function setLogSink() {}",
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
const { buildContext, isSensitiveKey, shouldPersist, PERSISTED_INFO_MESSAGES } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

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