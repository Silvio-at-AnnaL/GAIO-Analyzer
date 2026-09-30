import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./ai-client.js": `
    export class MissingApiKeyError extends Error {}
    globalThis.__preflightMissingApiKeyError = MissingApiKeyError;
    export async function resolveLlmConfig() {
      const state = globalThis.__preflightTest;
      if (state.configError) throw state.configError;
      return state.config;
    }
    export async function callLLM(...args) {
      const state = globalThis.__preflightTest;
      state.calls.push(args);
      return state.respond();
    }
  `,
  "./logger.js": `
    export const logger = {
      info(obj, msg) { globalThis.__preflightTest.logs.push({ level: "info", obj, msg }); },
      warn(obj, msg) { globalThis.__preflightTest.logs.push({ level: "warn", obj, msg }); },
    };
  `,
};
const { outputFiles } = await build({
  entryPoints: [new URL("./llm-preflight.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "preflight-mocks",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) =>
        Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) =>
        ({ contents: mocks[args.path], loader: "js" }));
    },
  }],
});
const { checkLlmReady, resetLlmPreflightCache } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

function reset() {
  resetLlmPreflightCache();
  globalThis.__preflightTest = {
    config: { provider: "claude", model: "test-model", hasKey: true },
    configError: null, calls: [], logs: [], respond: async () => "OK",
  };
  return globalThis.__preflightTest;
}

test("one real call returns ready result, logs success, and passes the short timeout", async () => {
  const state = reset();
  const result = await checkLlmReady();
  assert.equal(result.ok, true);
  assert.equal(result.provider, "claude");
  assert.equal(result.model, "test-model");
  assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0);
  assert.ok(!Number.isNaN(Date.parse(result.checkedAt)));
  assert.deepEqual(state.calls, [["Reply with the single word OK.", 16, 0,
    { module: "preflight", timeoutMs: 15_000, maxRetries: 0 }]]);
  assert.deepEqual(state.logs.filter(({ msg }) => msg === "llm preflight ok")
    .map(({ obj }) => obj.cached), [false]);
});

test("successes are cached, force bypasses cache, and reset clears it", async () => {
  const state = reset();
  const first = await checkLlmReady();
  assert.equal(await checkLlmReady(), first);
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.logs.filter(({ msg }) => msg === "llm preflight ok")
    .map(({ obj }) => obj.cached), [false, true]);
  await checkLlmReady({ force: true });
  assert.equal(state.calls.length, 2);
  resetLlmPreflightCache();
  await checkLlmReady();
  assert.equal(state.calls.length, 3);
});

test("failure is not cached: no_key and provider_error include only safe diagnostics", async () => {
  const state = reset();
  state.respond = async () => { throw new globalThis.__preflightMissingApiKeyError("secret must not be returned"); };
  const noKey = await checkLlmReady();
  assert.deepEqual({
    ...noKey, durationMs: 0,
  }, { ok: false, provider: "claude", model: "test-model", reason: "no_key",
    errorName: "Error", durationMs: 0 });
  assert.equal((await checkLlmReady()).reason, "no_key");
  assert.equal(state.calls.length, 2);
  const error = new Error("secret must not be returned");
  error.name = "RateLimitError";
  error.status = 429;
  state.respond = async () => { throw error; };
  const failed = await checkLlmReady();
  assert.equal(failed.reason, "provider_error");
  assert.equal(failed.status, 429);
  assert.equal(failed.errorName, "RateLimitError");
  assert.equal(failed.errorMessage, undefined);
  assert.ok(!JSON.stringify([failed, ...state.logs]).includes("secret"));
  assert.equal(state.logs.filter(({ msg }) => msg === "llm preflight failed").length, 3);
});

test("concurrent callers share one in-flight call, including force", async () => {
  const state = reset();
  let release;
  state.respond = () => new Promise((resolve) => { release = resolve; });
  const a = checkLlmReady();
  const b = checkLlmReady({ force: true });
  // Config resolution is asynchronous; allow the shared check to reach callLLM.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.calls.length, 1);
  release("OK");
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first, second);
});

test("a failed forced check clears an earlier successful cache entry", async () => {
  const state = reset();
  await checkLlmReady();
  state.respond = async () => { throw new Error("Provider unavailable"); };
  assert.equal((await checkLlmReady({ force: true })).ok, false);
  state.respond = async () => "OK";
  assert.equal((await checkLlmReady()).ok, true);
  assert.equal(state.calls.length, 3);
});