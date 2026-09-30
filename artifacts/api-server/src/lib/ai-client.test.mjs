import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./admin-db.js": `
    export async function getSetting(key) {
      const state = globalThis.__aiClientTest;
      if (state.settingsUnavailable && key === "ai_provider") throw new Error("Settings unavailable");
      return state.settings[key] ?? null;
    }
  `,
  "./logger.js": `
    export const logger = {
      info(obj, msg) { globalThis.__aiClientTest.logs.push({ level: "info", obj, msg }); },
      warn(obj, msg) { globalThis.__aiClientTest.logs.push({ level: "warn", obj, msg }); },
    };
  `,
  "@anthropic-ai/sdk": `
    export default class Anthropic {
      constructor(options) {
        const state = globalThis.__aiClientTest;
        state.clients.push({ provider: "claude", options });
        this.messages = {
          create: async (request) => {
            state.requests.push({ provider: "claude", request });
            if (state.sdkError) throw state.sdkError;
            return {
              content: [{ type: "text", text: "Claude response" }],
              usage: { input_tokens: 15, output_tokens: 7 },
            };
          },
        };
      }
    }
  `,
  "openai": `
    export default class OpenAI {
      constructor(options) {
        const state = globalThis.__aiClientTest;
        state.clients.push({ provider: "openai-compatible", options });
        this.chat = { completions: {
          create: async (request) => {
            state.requests.push({ provider: "openai-compatible", request });
            if (state.sdkError) throw state.sdkError;
            return {
              choices: [{ message: { content: "OpenAI response" } }],
              usage: { prompt_tokens: 22, completion_tokens: 11 },
            };
          },
        } };
      }
    }
  `,
  "@google/generative-ai": `
    export class GoogleGenerativeAI {
      constructor(apiKey) { globalThis.__aiClientTest.clients.push({ provider: "gemini", apiKey }); }
      getGenerativeModel() {
        return { generateContent: async () => ({ response: { text: () => "Gemini response" } }) };
      }
    }
  `,
};

const { outputFiles } = await build({
  entryPoints: [new URL("./ai-client.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "mock-ai-client-imports",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) =>
        Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "ai-client-mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "ai-client-mock" }, (args) => ({
        contents: mocks[args.path],
        loader: "js",
      }));
    },
  }],
});
const { callLLM, resolveLlmConfig, MissingApiKeyError } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

const key = "anthropic-direct-secret-test-key";
const model = "claude-custom-admin-model";
function reset(settings = {}) {
  globalThis.__aiClientTest = {
    settings: { ai_provider: "claude", ai_model_claude: model, ...settings },
    clients: [],
    requests: [],
    logs: [],
    sdkError: null,
    settingsUnavailable: false,
  };
  return globalThis.__aiClientTest;
}
const routes = (state) => state.logs.filter(({ msg }) => msg === "callLLM route");

test("Claude uses the stored key/model directly, with timeout/retries and usage metrics", async () => {
  const state = reset({ ai_api_key_claude: key });
  assert.equal(await callLLM("prompt", 123, 0.3, { module: "content-relevance" }), "Claude response");
  assert.deepEqual(state.clients, [{
    provider: "claude", options: { apiKey: key, timeout: 120_000, maxRetries: 2 },
  }]);
  assert.equal(Object.hasOwn(state.clients[0].options, "baseURL"), false);
  assert.equal(state.requests[0].request.model, model);
  assert.equal(state.requests[0].request.max_tokens, 123);
  assert.equal(state.requests[0].request.temperature, 0.3);
  assert.equal(routes(state).length, 1);
  assert.deepEqual({ ...routes(state)[0].obj, durationMs: 0 }, {
    provider: "claude", route: "direct", model, module: "content-relevance",
    durationMs: 0, inputTokens: 15, outputTokens: 7,
  });
  assert.ok(typeof routes(state)[0].obj.durationMs === "number" && routes(state)[0].obj.durationMs >= 0);
  assert.ok(!JSON.stringify(state.logs).includes(key));
});

test("module defaults to unknown and OpenAI-compatible usage is logged", async () => {
  const state = reset({ ai_provider: "openai", ai_api_key_openai: "openai-test-key" });
  assert.equal(await callLLM("prompt"), "OpenAI response");
  assert.deepEqual(state.clients[0].options, {
    apiKey: "openai-test-key", timeout: 120_000, maxRetries: 2,
  });
  assert.deepEqual({ ...routes(state)[0].obj, durationMs: 0 }, {
    provider: "openai", route: "direct", model: "gpt-4o",
    module: "unknown", durationMs: 0, inputTokens: 22, outputTokens: 11,
  });
});

test("custom and Perplexity providers retain their own model and base URL", async () => {
  const custom = reset({
    ai_provider: "custom-1",
    ai_custom_providers: JSON.stringify([{
      id: "custom-1", api_key: "custom-test-key", base_url: "https://custom.example",
      model: "custom-model", enabled: true,
    }]),
  });
  assert.equal(await callLLM("prompt"), "OpenAI response");
  assert.equal(custom.clients[0].options.baseURL, "https://custom.example");
  assert.equal(custom.requests[0].request.model, "custom-model");
  assert.equal(routes(custom)[0].obj.inputTokens, 22);
  const perplexity = reset({ ai_provider: "perplexity", ai_api_key_perplexity: "perplexity-test-key" });
  assert.equal(await callLLM("prompt"), "OpenAI response");
  assert.equal(perplexity.clients[0].options.baseURL, "https://api.perplexity.ai");
  assert.equal(perplexity.clients[0].options.maxRetries, 2);
});

test("Gemini retains its API and reports unavailable token usage", async () => {
  const state = reset({ ai_provider: "gemini", ai_api_key_gemini: "gemini-test-key" });
  assert.equal(await callLLM("prompt"), "Gemini response");
  assert.equal(routes(state)[0].obj.inputTokens, null);
  assert.equal(routes(state)[0].obj.outputTokens, null);
});

test("missing key for each selected provider warns and throws without an SDK call", async () => {
  for (const provider of ["claude", "openai", "perplexity", "gemini", "custom-1"]) {
    const state = reset({ ai_provider: provider });
    await assert.rejects(callLLM("prompt", 4096, 0, { module: "test-module" }), /No API key configured/);
    assert.deepEqual(state.clients, []);
    assert.deepEqual(state.requests, []);
    assert.deepEqual(state.logs.filter(({ level, msg }) => level === "warn" && msg === "callLLM: no API key configured")
      .map(({ obj }) => obj), [{ provider, module: "test-module" }]);
    assert.deepEqual(routes(state), []);
  }
});

test("SDK failure redacts the key, logs timing and module, and rethrows without another call", async () => {
  const state = reset({ ai_api_key_claude: key });
  const error = new Error(`Request failed for ${key}`);
  error.name = `AnthropicError-${key}`;
  error.status = 401;
  error.headers = { authorization: key };
  state.sdkError = error;
  await assert.rejects(callLLM("prompt", 4096, 0, { module: "faq-quality" }), (caught) => caught === error);
  assert.equal(state.clients.length, 1);
  assert.equal(state.requests.length, 1);
  assert.deepEqual(routes(state), []);
  const warning = state.logs.find(({ msg }) => msg === "callLLM provider failed");
  assert.deepEqual({ ...warning.obj, durationMs: 0 }, {
    provider: "claude", model, module: "faq-quality", durationMs: 0,
    errorName: "AnthropicError-[REDACTED]", status: 401,
    errorMessage: "Request failed for [REDACTED]",
  });
  assert.ok(typeof warning.obj.durationMs === "number" && warning.obj.durationMs >= 0);
  assert.ok(!JSON.stringify(state.logs).includes(key));
  assert.ok(!JSON.stringify(state.logs).includes("headers"));
});

test("non-numeric status is omitted and selected OpenAI key is redacted", async () => {
  const state = reset({ ai_provider: "openai", ai_api_key_openai: "openai-test-key" });
  const error = new Error("Rejected openai-test-key");
  error.status = "429";
  state.sdkError = error;
  await assert.rejects(callLLM("prompt"), (caught) => caught === error);
  const warning = state.logs.find(({ msg }) => msg === "callLLM provider failed").obj;
  assert.equal(Object.hasOwn(warning, "status"), false);
  assert.equal(warning.errorMessage, "Rejected [REDACTED]");
  assert.ok(!JSON.stringify(state.logs).includes("openai-test-key"));
  assert.equal(state.requests.length, 1);
});

test("settings unavailable warns, defaults to Claude, and still requires a key", async () => {
  const state = reset({ ai_api_key_claude: key });
  state.settingsUnavailable = true;
  assert.equal(await callLLM("prompt"), "Claude response");
  assert.ok(state.logs.some(({ msg }) => msg === "callLLM settings unavailable — using default provider"));
  assert.equal(routes(state)[0].obj.provider, "claude");
  state.settings.ai_api_key_claude = "";
  state.logs = [];
  await assert.rejects(callLLM("prompt"), /No API key configured/);
  assert.ok(state.logs.some(({ msg }) => msg === "callLLM: no API key configured"));
});

test("source no longer contains integration env references or the integration import", async () => {
  const source = await readFile(new URL("./ai-client.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("AI_" + "INTEGRATIONS"));
  assert.ok(!source.includes("integrations-" + "anthropic-ai"));
});

test("resolveLlmConfig exposes provider, model and key presence but never the key", async () => {
  reset({ ai_api_key_claude: key });
  assert.deepEqual(await resolveLlmConfig(), { provider: "claude", model, hasKey: true });
  const state = reset({ ai_provider: "openai" });
  assert.deepEqual(await resolveLlmConfig(), { provider: "openai", model: "gpt-4o", hasKey: false });
  assert.equal(state.clients.length, 0);
  await assert.rejects(callLLM("prompt"), MissingApiKeyError);
});

test("per-call timeout and retry overrides reach Anthropic and OpenAI constructors", async () => {
  const claude = reset({ ai_api_key_claude: key });
  await callLLM("prompt", 16, 0, { module: "preflight", timeoutMs: 15_000, maxRetries: 0 });
  assert.deepEqual(claude.clients[0].options, {
    apiKey: key, timeout: 15_000, maxRetries: 0,
  });
  const openai = reset({ ai_provider: "openai", ai_api_key_openai: "test-openai-key" });
  await callLLM("prompt", 16, 0, { timeoutMs: 15_000, maxRetries: 0 });
  assert.deepEqual(openai.clients[0].options, {
    apiKey: "test-openai-key", timeout: 15_000, maxRetries: 0,
  });
});