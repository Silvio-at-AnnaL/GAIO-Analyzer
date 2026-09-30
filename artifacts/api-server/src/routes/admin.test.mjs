import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  express: `
    export function Router() {
      const routes = new Map();
      const router = {};
      for (const method of ["get", "post", "patch", "put", "delete"]) {
        router[method] = (path, ...handlers) => {
          routes.set(method.toUpperCase() + " " + path, handlers);
          return router;
        };
      }
      globalThis.__adminTestRoutes = routes;
      return router;
    }
  `,
  bcryptjs: `export default { compare: async () => true, hash: async () => "hash" };`,
  "express-rate-limit": `export default () => (_req, _res, next) => next();`,
  cheerio: `export const load = () => ({ text: () => "", html: () => "" });`,
  pg: `export class Client { async connect() {} async query() {} async end() {} }`,
  "../lib/admin-db.js": `
    export async function getSetting(key) { return globalThis.__adminTest.settings[key] ?? null; }
    export async function setSetting(key, value) {
      globalThis.__adminTest.settings[key] = value;
      globalThis.__adminTest.saved.push([key, value]);
    }
    export async function saveAnalysisExport() {}
  `,
  "../lib/db.js": `export async function query() { return { rows: [] }; }`,
  "../lib/bootstrap.js": `export function getDatabaseUrl() { return ""; }`,
  "../lib/mailer.js": `export async function sendMail() { return { ok: true }; }`,
  "../lib/admin-auth.js": `
    export function signToken() { return "token"; }
    export function verifyToken(token) {
      if (token === "valid-admin") return { userId: 1, username: "admin", role: "admin" };
      if (token === "valid-user") return { userId: 2, username: "user", role: "user" };
      return null;
    }
    export function validatePasswordPolicy() { return null; }
    export function generateTempPassword() { return "temporary"; }
  `,
  "../lib/admin-email.js": `export async function sendEmail() { return { ok: true }; }`,
  "../lib/logger.js": `export const logger = { info() {}, warn() {}, error() {} };`,
  "../lib/ai-client.js": `export async function callLLM() { return ""; }`,
  "../lib/llm-preflight.js": `
    export async function checkLlmReady(options) {
      globalThis.__adminTest.preflightChecks.push(options);
      return { ok: true, provider: "claude", model: "test-model", durationMs: 1 };
    }
    export function resetLlmPreflightCache() { globalThis.__adminTest.cacheResets++; }
  `,
  "../lib/prompt-manager.js": `
    export async function getPrompt() { return ""; }
    export function fillTemplate() { return ""; }
    export function clearPromptCache() {}
  `,
  "../lib/prompt-defaults.js": `export const PROMPT_DEFAULTS_MAP = {};`,
  "../lib/score-config.js": `
    export const SCORE_PROFILES = [];
    export function getScoreParams() { return {}; }
    export function setScoreParam() {}
    export function resetScoreParams() {}
  `,
  "node:crypto": `export function randomUUID() { return "test-uuid"; }`,
};

const { outputFiles } = await build({
  entryPoints: [new URL("./admin.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "admin-route-mocks",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) =>
        Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "admin-mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "admin-mock" }, (args) => ({
        contents: mocks[args.path],
        loader: "js",
      }));
    },
  }],
});
await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

function reset(settings = {}) {
  globalThis.__adminTest = {
    settings: { ...settings },
    saved: [],
    cacheResets: 0,
    preflightChecks: [],
  };
  return globalThis.__adminTest;
}

async function request(method, path, { token = "valid-admin", body = {} } = {}) {
  const handlers = globalThis.__adminTestRoutes.get(`${method} ${path}`);
  assert.ok(handlers, `Route not registered: ${method} ${path}`);
  const req = {
    cookies: token ? { gaio_admin_token: token } : {},
    body,
    params: { group: "ai" },
    query: {},
  };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
  for (const handler of handlers) {
    let nextCalled = false;
    await handler(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
  return res;
}

test("ai_key_valid_until accepts empty and valid ISO dates and rejects invalid dates", async () => {
  const state = reset();
  const empty = await request("PATCH", "/settings/:group", {
    body: { ai_key_valid_until: "" },
  });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body, { success: true });
  assert.deepEqual(state.saved, [["ai_key_valid_until", ""]]);

  const valid = await request("PATCH", "/settings/:group", {
    body: { ai_key_valid_until: "2035-06-07" },
  });
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(state.saved.at(-1), ["ai_key_valid_until", "2035-06-07"]);

  for (const invalidDate of ["2035-6-07", "2035-02-30", "tomorrow"]) {
    const invalid = await request("PATCH", "/settings/:group", {
      body: { ai_key_valid_until: invalidDate },
    });
    assert.equal(invalid.statusCode, 400, `Expected ${invalidDate} to be rejected`);
    assert.deepEqual(invalid.body, { error: "Ungültiges Ablaufdatum" });
  }
  assert.equal(state.cacheResets, 2);
});

test("ai-status reports future, today, past, and unset expiry days in UTC", async () => {
  const state = reset();
  const today = new Date().toISOString().slice(0, 10);
  const asDate = (offset) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  for (const [date, expected] of [[asDate(5), 5], [today, 0], [asDate(-2), -2], ["", null]]) {
    state.settings.ai_key_valid_until = date;
    const res = await request("GET", "/settings/ai-status");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.keyValidUntil, date || null);
    assert.equal(res.body.keyDaysLeft, expected);
  }
});

test("successful AI settings saves reset the preflight cache", async () => {
  const state = reset();
  const res = await request("PATCH", "/settings/:group", {
    body: { ai_key_valid_until: "2035-06-07" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.cacheResets, 1);
});

test("ai-test requires admin auth and force-checks readiness for admins", async () => {
  const state = reset();
  const anonymous = await request("POST", "/settings/ai-test", { token: null });
  assert.equal(anonymous.statusCode, 401);
  const nonAdmin = await request("POST", "/settings/ai-test", { token: "valid-user" });
  assert.equal(nonAdmin.statusCode, 403);
  const admin = await request("POST", "/settings/ai-test");
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.body.ok, true);
  assert.deepEqual(state.preflightChecks, [{ force: true }]);
});