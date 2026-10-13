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
    export async function saveAnalysisExportOnce(logId, html) {
      const state = globalThis.__adminTest;
      state.exportCalls.push([logId, html]);
      if (state.exportError) throw state.exportError;
      if (state.exports.has(logId)) return null;
      const id = 1000 + state.exports.size;
      state.exports.set(logId, id);
      return id;
    }
  `,
  "../lib/db.js": `export async function query(sql, params) {
    globalThis.__adminTest.queries.push([sql, params]);
    return { rows: [] };
  }`,
  "../lib/analysis-engine.js": `export function getAnalysis(id) {
    return globalThis.__adminTest.analyses.get(id);
  }`,
  "../lib/bootstrap.js": `export function getDatabaseUrl() { return ""; }`,
  "../lib/mailer.js": `export async function sendMail(options) {
    globalThis.__adminTest.mails.push(options);
    return { ok: true };
  }`,
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
    analyses: new Map(),
    exports: new Map(),
    exportCalls: [],
    queries: [],
    mails: [],
  };
  return globalThis.__adminTest;
}

async function request(method, path, { token = "valid-admin", body = {} } = {}) {
  const handlers = globalThis.__adminTestRoutes.get(`${method} ${path}`);
  if (!handlers) return { statusCode: 404 };
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

test("changing the active provider clears the saved key expiry date", async () => {
  const state = reset({ ai_provider: "claude", ai_key_valid_until: "2035-06-07" });
  const response = await request("PATCH", "/settings/:group", {
    body: { ai_provider: "openai", ai_key_valid_until: "2035-08-01" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(state.settings.ai_provider, "openai");
  assert.equal(state.settings.ai_key_valid_until, "");
  assert.equal(state.cacheResets, 1);

  state.saved.length = 0;
  await request("PATCH", "/settings/:group", { body: { ai_provider: "openai" } });
  assert.equal(state.saved.some(([key]) => key === "ai_key_valid_until"), false);
});

test("changing the active built-in key clears expiry, but an unchanged or inactive key does not", async () => {
  const state = reset({
    ai_provider: "claude", ai_api_key_claude: "old-key",
    ai_api_key_openai: "other-key", ai_key_valid_until: "2035-06-07",
  });
  await request("PATCH", "/settings/:group", { body: { ai_api_key_openai: "new-other-key" } });
  assert.equal(state.settings.ai_key_valid_until, "2035-06-07");
  await request("PATCH", "/settings/:group", { body: { ai_api_key_claude: "old-key" } });
  assert.equal(state.settings.ai_key_valid_until, "2035-06-07");
  await request("PATCH", "/settings/:group", { body: { ai_api_key_claude: "••••••••" } });
  assert.equal(state.settings.ai_key_valid_until, "2035-06-07");
  await request("PATCH", "/settings/:group", { body: { ai_api_key_claude: "new-key" } });
  assert.equal(state.settings.ai_key_valid_until, "");
  assert.equal(state.cacheResets, 4);
});

test("changing the active custom provider key clears expiry after preserving masked keys", async () => {
  const custom = (api_key, name = "Custom") => [{
    id: "custom-1", name, api_key, base_url: "https://example.test", model: "model", enabled: true,
  }];
  const state = reset({
    ai_provider: "custom-1", ai_custom_providers: JSON.stringify(custom("old-key")),
    ai_key_valid_until: "2035-06-07",
  });
  await request("PATCH", "/settings/:group", {
    body: { ai_custom_providers: JSON.stringify(custom("••••••••", "Renamed")) },
  });
  assert.equal(state.settings.ai_key_valid_until, "2035-06-07");
  await request("PATCH", "/settings/:group", {
    body: { ai_custom_providers: JSON.stringify(custom("new-key", "Renamed")) },
  });
  assert.equal(state.settings.ai_key_valid_until, "");
  assert.equal(state.cacheResets, 2);
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

const analysisId = "11111111-1111-4111-8111-111111111111";
const autoExport = body => request("POST", "/analysis-log/auto-export", { token: null, body });

test("anonymous POST by log ID is gone while the admin GET download still requires auth", async () => {
  reset();
  assert.equal(globalThis.__adminTestRoutes.has("POST /analysis-log/:id/export"), false);
  assert.equal((await request("POST", "/analysis-log/:id/export", { token: null })).statusCode, 404);
  assert.equal(globalThis.__adminTestRoutes.has("GET /analysis-log/:id/export"), true);
  assert.equal((await request("GET", "/analysis-log/:id/export", { token: null })).statusCode, 401);
});

test("auto-export rejects missing or invalid UUIDs and missing or non-string HTML", async () => {
  const state = reset();
  for (const value of [undefined, null, 123, "", "not-a-uuid", ` ${analysisId}`]) {
    assert.equal((await autoExport({ analysisId: value, htmlContent: "<html/>" })).statusCode, 400);
  }
  for (const htmlContent of [undefined, null, 123, {}, []]) {
    assert.equal((await autoExport({ analysisId, htmlContent })).statusCode, 400);
  }
  assert.deepEqual(state.exportCalls, []);
  assert.deepEqual(state.mails, []);
});

test("auto-export returns 404 for unknown analyses and analyses with no log entry", async () => {
  const state = reset();
  const body = { analysisId, htmlContent: "<html/>" };
  assert.equal((await autoExport(body)).statusCode, 404);
  state.analyses.set(analysisId, { status: "completed", logId: null, url: "https://server.test" });
  assert.equal((await autoExport(body)).statusCode, 404);
  assert.deepEqual(state.exportCalls, []);
  assert.deepEqual(state.queries, []);
});

test("auto-export returns 409 for running analyses without saving or sending mail", async () => {
  const state = reset({ delivery_bcc: "archive@example.test" });
  state.analyses.set(analysisId, { status: "running", logId: 42, url: "https://server.test" });
  assert.equal((await autoExport({ analysisId, htmlContent: "<html/>" })).statusCode, 409);
  assert.deepEqual(state.exportCalls, []);
  assert.deepEqual(state.mails, []);
});

test("completed auto-export saves once, ignores supplied metadata, and escapes the server domain in its only BCC", async () => {
  const state = reset({ delivery_bcc: "archive@example.test" });
  const domain = `https://server.test/<path>&"'`;
  state.analyses.set(analysisId, { status: "completed", logId: 42, url: domain });
  const body = {
    analysisId, htmlContent: "<html>report</html>", logId: 999,
    domain: "https://attacker.test", companyName: "Untrusted", gaioScore: 100,
    scoresJson: "untrusted", pagesCrawled: 999,
  };
  const first = await autoExport(body);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { exportId: 1000, logId: 42 });
  const second = await autoExport({ ...body, htmlContent: "<html>replacement</html>" });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.body, { skipped: true, logId: 42 });
  assert.deepEqual(state.exportCalls, [[42, body.htmlContent], [42, "<html>replacement</html>"]]);
  assert.deepEqual([...state.exports], [[42, 1000]]);
  // No DB status check or client-metadata SQL: completed memory state is sufficient.
  assert.deepEqual(state.queries, []);
  assert.equal(state.mails.length, 1);
  assert.equal(state.mails[0].to, "archive@example.test");
  assert.ok(state.mails[0].html.includes("<strong>https://server.test/&lt;path&gt;&amp;&quot;&#39;</strong>"));
  assert.ok(!state.mails[0].html.includes("attacker.test"));
  assert.ok(state.mails[0].subject.includes(domain));
  assert.equal(state.mails[0].attachments[0].content, body.htmlContent);
  const safeBase = domain.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);
  assert.equal(state.mails[0].attachments[0].filename, `GAIO-Report-${safeBase}.html`);
});

test("failed auto-export is allowed and accepts string HTML without requiring a domain", async () => {
  const state = reset();
  state.analyses.set(analysisId, { status: "failed", logId: 42, url: null });
  const response = await autoExport({ analysisId, htmlContent: "" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { exportId: 1000, logId: 42 });
  assert.deepEqual(state.exportCalls, [[42, ""]]);
  assert.deepEqual(state.mails, []);
});

test("concurrent auto-export requests send only one BCC", async () => {
  const state = reset({ delivery_bcc: "archive@example.test" });
  state.analyses.set(analysisId, { status: "completed", logId: 42, url: "https://server.test" });
  const responses = await Promise.all([
    autoExport({ analysisId, htmlContent: "first" }),
    autoExport({ analysisId, htmlContent: "second" }),
  ]);
  assert.ok(responses.every(response => response.statusCode === 200));
  assert.equal(responses.filter(response => response.body.skipped === true).length, 1);
  assert.equal(state.mails.length, 1);
});

test("auto-export save errors return 500 without sending BCC", async () => {
  const state = reset({ delivery_bcc: "archive@example.test" });
  state.analyses.set(analysisId, { status: "completed", logId: 42, url: "https://server.test" });
  state.exportError = new Error("Synthetic DB failure");
  assert.equal((await autoExport({ analysisId, htmlContent: "report" })).statusCode, 500);
  assert.deepEqual(state.mails, []);
});