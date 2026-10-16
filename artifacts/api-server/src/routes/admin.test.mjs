import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { deliveryRouteTests } from "./report-deliveries-tests.mjs";
import { adminFeaturePermissionTests } from "./admin-feature-permissions-tests.mjs";
import { currentUserAuthTests } from "./current-user-auth-tests.mjs";
import { crawlExclusionRouteTests } from "./crawl-exclusions-tests.mjs";

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
  "express-rate-limit": `export default options => {
    const middleware = (_req, _res, next) => next();
    middleware.options = options;
    return middleware;
  };`,
  cheerio: `export const load = () => ({ text: () => "", html: () => "" });`,
  pg: `export class Client { async connect() {} async query() {} async end() {} }`,
  "../lib/admin-db.js": `
    export async function getSetting(key) {
      globalThis.__adminTest.settingReads.push(key);
      return globalThis.__adminTest.settings[key] ?? null;
    }
    export async function setSetting(key, value) {
      globalThis.__adminTest.settings[key] = value;
      globalThis.__adminTest.saved.push([key, value]);
    }
    export async function saveAnalysisExport(...args) { globalThis.__adminTest.legacyExportCalls.push(args); }
    export async function countReportDeliveries(logId) {
      globalThis.__adminTest.countCalls.push(logId);
      return globalThis.__adminTest.deliveries.filter(row => row.analysisLogId === logId).length;
    }
    export async function insertReportDelivery(row) {
      const state = globalThis.__adminTest;
      if (state.deliveryError) throw state.deliveryError;
      state.deliveries.push(row);
      return state.deliveries.length;
    }
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
  "../lib/db.js": `
    export async function query(sql, params) {
      const state = globalThis.__adminTest;
      // Track authentication lookups separately from route-handler queries so
      // existing tests can continue asserting that forbidden handlers do no work.
      if (sql === "SELECT id, username, role FROM users WHERE id = $1") {
        state.authQueries.push([sql, params]);
        if (state.authLookupError) throw state.authLookupError;
        const user = state.users.get(params[0]);
        return { rows: user ? [{ ...user }] : [] };
      }
      state.queries.push([sql, params]);
      if (state.crawlQuery && sql.includes("crawl_exclusion_rules")) return state.crawlQuery(sql, params);
      if (state.deliveryQuery) return state.deliveryQuery(sql, params);
      return { rows: state.deleteLogExists && sql === "SELECT id FROM analysis_log WHERE id = $1" ? [{ id: 42 }] : [] };
    }
    export async function withTransaction(fn) {
      const state = globalThis.__adminTest;
      const snapshot = { logExists: state.deleteLogExists, exportExists: state.deleteExportExists,
        deliveryLogId: state.deliveryLogId };
      state.transactionCalls.push("BEGIN");
      const client = { async query(sql, params) {
        state.transactionCalls.push([sql, params]);
        if (state.crawlQuery && sql.includes("crawl_exclusion_rules")) return state.crawlQuery(sql, params);
        if (sql.startsWith("DELETE FROM analysis_exports")) state.deleteExportExists = false;
        else if (sql.startsWith("DELETE FROM analysis_log")) {
          if (state.deleteError) throw state.deleteError;
          state.deleteLogExists = false;
          state.deliveryLogId = null;
        } else throw new Error("Unexpected transactional query");
        return { rows: [] };
      }};
      state.transactionClients.push(client);
      try {
        const result = await fn(client);
        state.transactionCalls.push("COMMIT");
        return result;
      } catch (err) {
        state.transactionCalls.push("ROLLBACK");
        state.deleteLogExists = snapshot.logExists;
        state.deleteExportExists = snapshot.exportExists;
        state.deliveryLogId = snapshot.deliveryLogId;
        throw err;
      }
    }
  `,
  "../lib/analysis-engine.js": `export function getAnalysis(id) {
    return globalThis.__adminTest.analyses.get(id);
  }`,
  "../lib/bootstrap.js": `export function getDatabaseUrl() { return ""; }`,
  "../lib/mailer.js": `export async function sendMail(options) {
    const state = globalThis.__adminTest;
    state.mails.push(options);
    const result = state.mailResults.shift() ?? { success: true };
    if (result instanceof Error) throw result;
    return result;
  }`,
  "../lib/admin-auth.js": `
    export function signToken() { return "token"; }
    export function verifyToken(token) {
      if (token === "valid-admin") return { userId: 1, username: "admin", role: "admin" };
      if (token === "valid-user") return { userId: 2, username: "user", role: "user" };
      if (token === "valid-extended") return { userId: 3, username: "extended", role: "user_extended" };
      return null;
    }
    export function validatePasswordPolicy() { return null; }
    export function generateTempPassword() { return "temporary"; }
  `,
  "../lib/admin-email.js": `export async function sendEmail() { return { ok: true }; }`,
  "../lib/logger.js": `export const logger = {
    info(...args) { globalThis.__adminTest.infos.push(args); }, warn(...args) { globalThis.__adminTest.warnings.push(args); }, error() {}
  };`,
  "../lib/crawl-exclusion-store.js": `export function invalidateCrawlExclusionCache() { globalThis.__adminTest.ruleInvalidations++; }`,
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
    settingReads: [],
    users: new Map([
      [1, { id: 1, username: "admin", role: "admin" }],
      [2, { id: 2, username: "user", role: "user" }],
      [3, { id: 3, username: "extended", role: "user_extended" }],
    ]),
    authQueries: [],
    saved: [],
    cacheResets: 0,
    preflightChecks: [],
    analyses: new Map(),
    exports: new Map(),
    exportCalls: [],
    queries: [],
    mails: [],
    mailResults: [],
    deliveries: [],
    countCalls: [],
    legacyExportCalls: [],
    warnings: [],
    infos: [],
    ruleInvalidations: 0,
    transactionCalls: [],
    transactionClients: [],
  };
  return globalThis.__adminTest;
}

async function request(method, path, { token = "valid-admin", body = {}, params = {}, query = {}, guardsOnly = false } = {}) {
  const handlers = globalThis.__adminTestRoutes.get(`${method} ${path}`);
  if (!handlers) return { statusCode: 404 };
  const req = {
    cookies: token ? { gaio_admin_token: token } : {},
    body,
    params: { group: "ai", ...params },
    query,
  };
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    clearedCookies: [],
    clearCookie(name, options) { this.clearedCookies.push([name, options]); return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
  for (const handler of guardsOnly ? handlers.slice(0, -1) : handlers) {
    let nextCalled = false;
    await handler(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
  res.adminUser = req.adminUser;
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

test("system event list and export share linked analysis/preparation filters and return prepId", async () => {
  const state = reset();
  const analysisId = "analysis-unit-id";
  const prepId = "abcdefab-1234-7bcd-abcd-abcdefabcdef";
  const records = [
    { id: "1", analysis_id: analysisId, prep_id: prepId },
    { id: "2", analysis_id: null, prep_id: prepId },
    { id: "3", analysis_id: analysisId, prep_id: null },
    { id: "4", analysis_id: "other-analysis", prep_id: "other-prep" },
  ].map(row => ({ ...row, created_at: "2026-10-16T10:00:00Z", level: 30, msg: row.id,
    analysis_domain: null, context: null }));
  state.deliveryQuery = (sql, params) => {
    assert.match(sql, /analysis_id = \$4 OR \(prep_id IS NOT NULL AND prep_id =\s*\(SELECT prep_id FROM analysis_log WHERE analysis_uuid = \$4 LIMIT 1\)\)/);
    assert.match(sql, /\(\$7::text IS NULL OR prep_id = \$7\)/);
    if (sql.includes("::bigint")) {
      assert.match(sql, /\$8::bigint/);
      assert.match(sql, /LIMIT \$9/);
      assert.equal(params.length, 9);
    } else {
      assert.match(sql, /LIMIT \$8/);
      assert.equal(params.length, 8);
    }
    const linkedPrep = params[3] === analysisId ? prepId : null;
    return { rows: records.filter(row =>
      (!params[3] || row.analysis_id === params[3] || (linkedPrep !== null && row.prep_id === linkedPrep)) &&
      (!params[6] || row.prep_id === params[6])
    ).reverse() };
  };
  for (const [filter, expected] of [
    [{}, ["1", "2", "3", "4"]],
    [{ analysisId }, ["1", "2", "3"]],
    [{ prepId: prepId.toUpperCase() }, ["1", "2"]],
    [{ analysisId, prepId }, ["1", "2"]],
    [{ analysisId: "other-analysis" }, ["4"]],
  ]) {
    const query = { minLevel: 30, ...filter };
    const list = await request("GET", "/system-events", { query });
    const exported = await request("GET", "/system-events/export", { query });
    assert.equal(list.statusCode, 200);
    assert.equal(exported.statusCode, 200);
    const data = JSON.parse(exported.body);
    assert.deepEqual(list.body.events.map(row => row.id).reverse(), expected);
    assert.deepEqual(data.events.map(row => row.id), expected);
    for (const row of [...list.body.events, ...data.events]) {
      assert.equal(row.prepId, records.find(record => record.id === row.id).prep_id);
    }
  }
  for (const path of ["/system-events", "/system-events/export"]) {
    assert.equal((await request("GET", path, { query: { prepId: "invalid" } })).statusCode, 400);
  }
});

test("admin analysis-log API includes stored provider/model and preparation metadata without key fields", async () => {
  const state = reset();
  state.deliveryQuery = sql => {
    if (sql.includes("COUNT(*)")) return { rows: [{ c: 1 }] };
    if (sql.includes("total_kb")) return { rows: [{ total_kb: 0 }] };
    assert.match(sql, /al\.prep_id, al\.llm_provider, al\.llm_model/);
    return { rows: [{ id: 1, analysis_uuid: "analysis", prep_id: "prep", llm_provider: "claude",
      llm_model: "stored-model", has_html_export: 0 }] };
  };
  const response = await request("GET", "/analysis-log");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.items[0].prepId, "prep");
  assert.equal(response.body.items[0].llmProvider, "claude");
  assert.equal(response.body.items[0].llmModel, "stored-model");
  assert.equal(Object.hasOwn(response.body.items[0], "apiKey"), false);
  assert.equal(Object.hasOwn(response.body.items[0], "hasKey"), false);
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

const validMailBody = {
  analysisId, recipientEmail: "customer@example.test", reportType: "html", htmlContent: "<html>report</html>",
};

deliveryRouteTests({ reset, request });
adminFeaturePermissionTests({ reset, request });
crawlExclusionRouteTests({ reset, request });
currentUserAuthTests({ reset, request });
const reportMail = body => request("POST", "/public/send-report", { token: null, body });
function completedMailAnalysis(settings = {}) {
  const state = reset(settings);
  state.analyses.set(analysisId, {
    status: "completed", logId: 42, url: `https://server.test/<path>&"'`,
    inputs: { companyName: `Server <Company>&"'` }, overallScore: 67,
  });
  return state;
}
function assertNoDelivery(state) {
  assert.deepEqual(state.mails, []);
  assert.deepEqual(state.deliveries, []);
  assert.deepEqual(state.legacyExportCalls, []);
  assert.deepEqual(state.queries, []);
}

test("send-report mounts the dedicated 10/hour IP rate limiter with German JSON errors", () => {
  const handlers = globalThis.__adminTestRoutes.get("POST /public/send-report");
  assert.equal(handlers.length, 2);
  assert.deepEqual(handlers[0].options, {
    windowMs: 60 * 60 * 1000, max: 10,
    message: { error: "Zu viele Report-Anfragen. Bitte warten Sie eine Stunde." },
    standardHeaders: true, legacyHeaders: false,
  });
  assert.ok(!Object.hasOwn(handlers[0].options, "keyGenerator"), "Uses the default per-IP key");
});

test("send-report validates UUID, analysis existence and completed status before other inputs", async () => {
  const state = reset();
  for (const id of [undefined, null, 123, "", "invalid"]) {
    assert.equal((await reportMail({ analysisId: id })).statusCode, 400);
  }
  assert.equal((await reportMail({ analysisId })).statusCode, 404);
  state.analyses.set(analysisId, { status: "completed", logId: null });
  assert.equal((await reportMail({ analysisId })).statusCode, 404);
  for (const status of ["running", "failed"]) {
    state.analyses.set(analysisId, { status, logId: 42 });
    assert.equal((await reportMail({ analysisId })).statusCode, 409);
  }
  assertNoDelivery(state);
});

test("send-report rejects multiple, whitespace, newline and overlong recipient addresses", async () => {
  const state = completedMailAnalysis();
  for (const recipientEmail of [
    undefined, null, 123, "", "invalid", "a@b", "a@@b.test",
    "a@example.test b@example.test", "a@example.test,b@example.test",
    "a@example.test;b@example.test", "a@example.test\nbcc@example.test",
    "a@example.test\r\n", "a @example.test", `${"a".repeat(255)}@example.test`,
  ]) {
    assert.equal((await reportMail({ ...validMailBody, recipientEmail })).statusCode, 400, String(recipientEmail));
  }
  assertNoDelivery(state);
});

test("send-report rejects invalid types, missing attachments and invalid PDF magic", async () => {
  const state = completedMailAnalysis();
  for (const body of [
    { ...validMailBody, reportType: "unknown" },
    { ...validMailBody, htmlContent: undefined },
    { ...validMailBody, htmlContent: 123 },
    { ...validMailBody, htmlContent: "" },
    { ...validMailBody, reportType: "pdf" },
    { ...validMailBody, reportType: "pdf", pdfBase64: Buffer.from("not a PDF").toString("base64") },
    { ...validMailBody, reportType: "pdf", pdfBase64: Buffer.from([0xa5, 0xd0, 0xc4, 0xc6, 0xad]).toString("base64") },
    { ...validMailBody, consentText: "x".repeat(1001) },
    { ...validMailBody, consentText: {} },
  ]) {
    assert.equal((await reportMail(body)).statusCode, 400);
  }
  assertNoDelivery(state);
});

test("send-report limits decoded PDF and UTF-8 HTML size including optional HTML on PDF requests", async () => {
  const state = completedMailAnalysis();
  const pdf = Buffer.alloc(7 * 1024 * 1024 + 1);
  pdf.write("%PDF-");
  assert.equal((await reportMail({
    ...validMailBody, reportType: "pdf", pdfBase64: pdf.toString("base64"),
  })).statusCode, 413);
  const htmlContent = "€".repeat(1024 * 1024 + 1);
  assert.equal((await reportMail({ ...validMailBody, htmlContent })).statusCode, 413);
  assert.equal((await reportMail({
    ...validMailBody, reportType: "pdf", pdfBase64: Buffer.from("%PDF-test").toString("base64"), htmlContent,
  })).statusCode, 413);
  assertNoDelivery(state);
});

test("send-report accepts exact PDF and HTML size limits and preserves both attachments", async () => {
  const state = completedMailAnalysis();
  const pdf = Buffer.alloc(7 * 1024 * 1024);
  pdf.write("%PDF-");
  const htmlContent = "x".repeat(3 * 1024 * 1024);
  const res = await reportMail({
    ...validMailBody, reportType: "pdf", pdfBase64: pdf.toString("base64"), htmlContent, filename: "../report.pdf",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(state.mails[0].attachments.length, 2);
  assert.equal(state.mails[0].attachments[0].content.length, pdf.length);
  assert.equal(state.mails[0].attachments[0].filename, ".._report.pdf");
  assert.equal(state.mails[0].attachments[1].content, htmlContent);
});

test("send-report uses server metadata, no customer BCC, and a separate escaped internal notification", async () => {
  const state = completedMailAnalysis({ delivery_bcc: "archive@example.test, other@example.test" });
  const res = await reportMail({
    ...validMailBody, recipientEmail: " customer@example.test ",
    domain: "attacker.test", companyName: "Attacker", gaioScore: 100,
    scoresJson: "untrusted", pagesCrawled: 999,
    consentMarketing: true, consentText: "Exact displayed checkbox text",
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, deliveryId: 1 });
  const [customer, notification] = state.mails;
  assert.equal(customer.to, "customer@example.test");
  assert.ok(!Object.hasOwn(customer, "bcc"));
  assert.ok(customer.html.includes("https://server.test/&lt;path&gt;&amp;&quot;&#39;"));
  assert.equal(notification.to, "archive@example.test, other@example.test");
  assert.equal(notification.subject, `Neuer Report-Abruf: https://server.test/<path>&"'`);
  for (const value of ["customer@example.test", "Server &lt;Company&gt;&amp;&quot;&#39;", "67", "Europe/Berlin", "html", "Ja", "zugestellt"]) {
    assert.ok(notification.html.includes(value), value);
  }
  assert.ok(notification.text.includes(`Server <Company>&"'`));
  assert.deepEqual(notification.attachments, customer.attachments);
  assert.ok(!notification.html.includes("attacker.test"));
  assert.deepEqual(state.deliveries, [{
    analysisLogId: 42, analysisUuid: analysisId, recipientEmail: "customer@example.test",
    reportType: "html", domain: `https://server.test/<path>&"'`,
    companyName: `Server <Company>&"'`, gaioScore: 67,
    consentMarketing: true, consentText: "Exact displayed checkbox text", status: "sent", errorMessage: null,
  }]);
  assert.deepEqual(state.queries, []);
  assert.deepEqual(state.legacyExportCalls, []);
});

test("send-report stores consent text only for boolean true, never for false, missing or truthy strings", async () => {
  const state = completedMailAnalysis();
  for (const consentMarketing of [undefined, false, "true", 1]) {
    assert.equal((await reportMail({ ...validMailBody, consentMarketing, consentText: "Discard this" })).statusCode, 200);
    assert.equal(state.deliveries.at(-1).consentMarketing, false);
    assert.equal(state.deliveries.at(-1).consentText, null);
  }
});

test("send-report rejects the sixth recorded delivery without sending or storing another", async () => {
  const state = completedMailAnalysis();
  for (let i = 0; i < 5; i++) assert.equal((await reportMail(validMailBody)).statusCode, 200);
  const res = await reportMail(validMailBody);
  assert.equal(res.statusCode, 429);
  assert.equal(state.mails.length, 5);
  assert.equal(state.deliveries.length, 5);
  assert.deepEqual(state.countCalls, Array(6).fill(42));
});

test("concurrent send-report requests cannot exceed the five-delivery cap", async () => {
  const state = completedMailAnalysis();
  const responses = await Promise.all(Array.from({ length: 6 }, () => reportMail(validMailBody)));
  assert.equal(responses.filter(res => res.statusCode === 200).length, 5);
  assert.equal(responses.filter(res => res.statusCode === 429).length, 1);
  assert.equal(state.mails.length, 5);
  assert.equal(state.deliveries.length, 5);
});

test("send-report failure returns 502, records failed delivery and still sends the internal notification", async () => {
  const state = completedMailAnalysis({ delivery_bcc: "archive@example.test" });
  state.mailResults.push({ success: false, error: "SMTP rejected" });
  const res = await reportMail(validMailBody);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: "E-Mail konnte nicht gesendet werden." });
  assert.equal(state.deliveries[0].status, "failed");
  assert.equal(state.deliveries[0].errorMessage, "SMTP rejected");
  assert.equal(state.mails.length, 2);
  assert.ok(state.mails[1].html.includes("fehlgeschlagen"));
  assert.ok(state.mails[1].text.includes("Kundenmail-Status: fehlgeschlagen"));
  assert.ok(state.mails[1].html.includes("Nein"));
});

test("send-report fallback returns 200 and records not_configured with no error", async () => {
  const state = completedMailAnalysis({ delivery_bcc: "archive@example.test" });
  state.mailResults.push({ success: true, fallback: true });
  assert.deepEqual((await reportMail(validMailBody)).body, { success: true, deliveryId: 1 });
  assert.equal(state.deliveries[0].status, "not_configured");
  assert.equal(state.deliveries[0].errorMessage, null);
  assert.ok(state.mails[1].text.includes("kein Mailserver konfiguriert"));
  assert.ok(state.mails[1].html.includes("kein Mailserver konfiguriert"));
});

test("internal notification failure is warned without changing a successful customer response", async () => {
  for (const failure of [{ success: false, error: "Internal SMTP failed" }, new Error("Internal mail threw")]) {
    const state = completedMailAnalysis({ delivery_bcc: "archive@example.test" });
    state.mailResults.push({ success: true }, failure);
    const res = await reportMail(validMailBody);
    assert.equal(res.statusCode, 200);
    assert.equal(state.deliveries[0].status, "sent");
    assert.equal(state.warnings.length, 1);
  }
});

test("thrown customer mail failure is recorded and still produces an internal notification", async () => {
  const state = completedMailAnalysis({ delivery_bcc: "archive@example.test" });
  state.mailResults.push(new Error("Customer mail threw"));
  assert.equal((await reportMail(validMailBody)).statusCode, 502);
  assert.equal(state.deliveries[0].errorMessage, "Customer mail threw");
  assert.equal(state.mails.length, 2);
});

test("send-report does not claim success if the delivery record could not be stored", async () => {
  const state = completedMailAnalysis();
  state.deliveryError = new Error("Synthetic DB failure");
  assert.equal((await reportMail(validMailBody)).statusCode, 500);
  assert.deepEqual(state.deliveries, []);
});

test("admin analysis deletion commits both deletes on one client and retains delivery records", async () => {
  const state = reset();
  state.deleteLogExists = true;
  state.deleteExportExists = true;
  state.deliveryLogId = 42;
  state.deliveries.push({ analysisUuid: analysisId, recipientEmail: "customer@example.test" });
  const res = await request("DELETE", "/analysis-log/:id", { params: { id: "42" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(state.transactionCalls, [
    "BEGIN", ["DELETE FROM analysis_exports WHERE analysis_id = $1", [42]],
    ["DELETE FROM analysis_log WHERE id = $1", [42]], "COMMIT",
  ]);
  assert.equal(state.transactionClients.length, 1);
  assert.deepEqual(state.queries, [["SELECT id FROM analysis_log WHERE id = $1", [42]]]);
  assert.equal(state.deleteLogExists, false);
  assert.equal(state.deleteExportExists, false);
  assert.equal(state.deliveryLogId, null);
  assert.equal(state.deliveries.length, 1);
});

test("admin analysis deletion rolls back the export when the log delete fails", async () => {
  const state = reset();
  state.deleteLogExists = true;
  state.deleteExportExists = true;
  state.deliveryLogId = 42;
  state.deleteError = new Error("Second delete failed");
  const res = await request("DELETE", "/analysis-log/:id", { params: { id: "42" } });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Fehler beim Löschen" });
  assert.equal(state.transactionClients.length, 1);
  assert.equal(state.transactionCalls.at(-1), "ROLLBACK");
  assert.ok(!state.transactionCalls.includes("COMMIT"));
  assert.equal(state.deleteExportExists, true);
  assert.equal(state.deleteLogExists, true);
  assert.equal(state.deliveryLogId, 42);
});

test("admin analysis deletion preserves authentication, validation and missing-log responses", async () => {
  const state = reset();
  assert.equal((await request("DELETE", "/analysis-log/:id", { token: null, params: { id: "42" } })).statusCode, 401);
  assert.equal((await request("DELETE", "/analysis-log/:id", { token: "valid-user", params: { id: "42" } })).statusCode, 403);
  assert.equal((await request("DELETE", "/analysis-log/:id", { params: { id: "invalid" } })).statusCode, 400);
  assert.equal((await request("DELETE", "/analysis-log/:id", { params: { id: "42" } })).statusCode, 404);
  assert.deepEqual(state.transactionCalls, []);
});