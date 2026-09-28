import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle just the module under test, replacing its imports before they can
// reach real SDKs, the database, or the production logger.
const mocks = {
  "./admin-db.js": `
    export async function getSetting(key) {
      return globalThis.__aiClientTest.settings[key] ?? null;
    }
  `,
  "./logger.js": `
    export const logger = {
      info(obj, msg) { globalThis.__aiClientTest.logs.push({ level: "info", obj, msg }); },
      warn(obj, msg) {
        globalThis.__aiClientTest.logs.push(typeof obj === "string"
          ? { level: "warn", obj: {}, msg: obj }
          : { level: "warn", obj, msg });
      },
    };
  `,
  "@anthropic-ai/sdk": `
    export default class Anthropic {
      constructor(options) {
        globalThis.__aiClientTest.clients.push(options);
        this.messages = {
          create: async (request) => {
            const state = globalThis.__aiClientTest;
            state.requests.push(request);
            if (state.directError && !("baseURL" in options)) throw state.directError;
            return { content: [{ type: "text", text: "Claude response" }] };
          },
        };
      }
    }
  `,
  "@workspace/integrations-anthropic-ai": `
    export const anthropic = {
      messages: {
        async create(request) {
          globalThis.__aiClientTest.fallbackRequests.push(request);
          return { content: [{ type: "text", text: "Fallback response" }] };
        },
      },
    };
  `,
  "openai": `export default class OpenAI {}`,
  "@google/generative-ai": `export class GoogleGenerativeAI {}`,
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
      builder.onResolve({ filter: /.*/ }, (args) => (
        Object.hasOwn(mocks, args.path)
          ? { path: args.path, namespace: "ai-client-mock" }
          : undefined
      ));
      builder.onLoad({ filter: /.*/, namespace: "ai-client-mock" }, (args) => ({
        contents: mocks[args.path],
        loader: "js",
      }));
    },
  }],
});
const { callLLM } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

const proxyKey = "replit-dummy-test-key";
const directKey = "anthropic-direct-secret-test-key";
const proxyURL = "https://proxy.example.invalid";
const adminModel = "claude-custom-admin-model";

function reset(settings = {}) {
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = proxyKey;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = proxyURL;
  globalThis.__aiClientTest = {
    settings: { ai_provider: "claude", ai_model_claude: adminModel, ...settings },
    clients: [],
    requests: [],
    fallbackRequests: [],
    logs: [],
    directError: null,
  };
  return globalThis.__aiClientTest;
}

function routeEntries(state) {
  return state.logs.filter(({ level, msg }) => level === "info" && msg === "callLLM route");
}

test("a distinct admin Claude key uses Anthropic directly and the stored model", async () => {
  const state = reset({ ai_api_key_claude: directKey });
  assert.equal(await callLLM("prompt", 123, 0.3), "Claude response");
  assert.deepEqual(state.clients, [{ apiKey: directKey }]);
  assert.equal(state.requests[0].model, adminModel);
  assert.equal(state.requests[0].max_tokens, 123);
  assert.equal(state.requests[0].temperature, 0.3);
  assert.deepEqual(routeEntries(state).map(({ obj }) => obj), [
    { provider: "claude", route: "direct", model: adminModel },
  ]);
  assert.equal(state.fallbackRequests.length, 0);
  assert.ok(!JSON.stringify(state.logs).includes(directKey));
});

test("the Replit integration key keeps proxy URL and proxy model", async () => {
  const state = reset({ ai_api_key_claude: proxyKey });
  assert.equal(await callLLM("prompt"), "Claude response");
  assert.deepEqual(state.clients, [{ apiKey: proxyKey, baseURL: proxyURL }]);
  assert.equal(state.requests[0].model, "claude-sonnet-4-6");
  assert.deepEqual(routeEntries(state).map(({ obj }) => obj), [
    { provider: "claude", route: "replit-proxy", model: "claude-sonnet-4-6" },
  ]);
  assert.ok(!JSON.stringify(state.logs).includes(proxyKey));
});

test("missing Claude key warns and uses the existing fallback", async () => {
  const state = reset({ ai_api_key_claude: "" });
  assert.equal(await callLLM("prompt"), "Fallback response");
  assert.equal(state.clients.length, 0);
  assert.equal(state.fallbackRequests[0].model, "claude-sonnet-4-6");
  assert.ok(state.logs.some(({ level, msg }) =>
    level === "warn" && msg === "callLLM: no Claude API key configured, using Replit integration"
  ));
  assert.deepEqual(routeEntries(state).map(({ obj }) => obj), [
    { provider: "claude", route: "fallback", model: "claude-sonnet-4-6" },
  ]);
});

test("direct SDK failure logs safe diagnostics then falls back", async () => {
  const state = reset({ ai_api_key_claude: directKey });
  const error = new Error(`Request failed for ${directKey}`);
  error.name = `AnthropicError-${directKey}`;
  error.status = 401;
  error.headers = { authorization: directKey };
  state.directError = error;

  assert.equal(await callLLM("prompt"), "Fallback response");
  const warning = state.logs.find(({ level, obj }) => level === "warn" && obj.route === "direct");
  assert.deepEqual(warning.obj, {
    provider: "claude",
    route: "direct",
    model: adminModel,
    errorName: "AnthropicError-[REDACTED]",
    status: 401,
    errorMessage: "Request failed for [REDACTED]",
  });
  assert.deepEqual(routeEntries(state).map(({ obj }) => obj), [
    { provider: "claude", route: "fallback", model: "claude-sonnet-4-6" },
  ]);
  assert.equal(state.fallbackRequests.length, 1);
  assert.ok(!JSON.stringify(state.logs).includes(directKey));
  assert.ok(!JSON.stringify(state.logs).includes("headers"));
});