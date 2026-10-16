import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

async function loadAdminDb() {
  const { outputFiles } = await build({
    entryPoints: [new URL("./admin-db.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [{
      name: "admin-db-migration-test-mocks",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => (
          Object.hasOwn(mocks, args.path)
            ? { path: args.path, namespace: "admin-db-test" }
            : undefined
        ));
        builder.onLoad({ filter: /.*/, namespace: "admin-db-test" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}

const state = { template: "", logs: [], updates: [], deletes: [], cleared: [] };
globalThis.__adminDbMigrationTest = state;
const mocks = {
  "./usage-snapshot.js": "export async function saveUsageSnapshot() {}",
  "bcryptjs": `export default { hash: async () => "not-used" };`,
  "./db.js": `
    export async function withTransaction(fn) { return fn({ query }); }
    export async function query(sql, params) {
      const state = globalThis.__adminDbMigrationTest;
      if (state.exportQuery) return state.exportQuery(sql, params);
      if (sql.includes("UPDATE prompts SET")) {
        state.updates.push(params);
        if (state.template === params[4]) {
          state.template = params[0];
          return { rows: [{ slug: params[3] }] };
        }
        return { rows: [] };
      }
      if (sql.includes("SELECT template FROM prompts")) {
        return { rows: state.template === null ? [] : [{ template: state.template }] };
      }
      if (sql.includes("DELETE FROM prompts")) {
        state.deletes.push({ sql, params });
        if (state.template === params[0]) {
          state.template = null;
          return { rows: [{ slug: "llm-discoverability-rating" }] };
        }
        return { rows: [] };
      }
      throw new Error("Unexpected SQL in migration test");
    }
  `,
  "./logger.js": `
    export const logger = {
      info(obj, msg) { globalThis.__adminDbMigrationTest.logs.push({ level: "info", msg: msg ?? obj }); },
      warn(obj, msg) { globalThis.__adminDbMigrationTest.logs.push({ level: "warn", msg: msg ?? obj }); },
    };
  `,
  "./prompt-defaults.js": `export { PROMPT_DEFAULTS } from "./defaults";`,
  "./defaults": `
    export const PROMPT_DEFAULTS = [{
      slug: "content-relevance",
      template: "fixture content relevance",
      description: "fixture",
      placeholders: [],
    }, {
      slug: "llm-discoverability-a",
      template: "updated default template",
      description: "updated description",
      placeholders: [{ key: "{{COMBINED_CONTENT}}", description: "unchanged placeholder" }],
    }];
  `,
  "./prompt-manager.js": `
    export function clearPromptCache(slug) {
      globalThis.__adminDbMigrationTest.cleared.push(slug);
    }
  `,
};

test("analysis-log insertion stores nullable correlation/provider metadata without credentials", async () => {
  const db = await loadAdminDb();
  const calls = [];
  state.exportQuery = async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 42 }] }; };
  try {
    assert.equal(await db.createAnalysisLog({ uuid: "analysis", domain: "example.test", mode: "url",
      prepId: "prep", llmProvider: "claude", llmModel: "stored-model" }), 42);
    assert.match(calls[0].sql, /prep_id, llm_provider, llm_model/);
    assert.deepEqual(calls[0].params, ["analysis", "example.test", null, "url", null, "prep", "claude", "stored-model"]);
    await db.createAnalysisLog({ uuid: "legacy", domain: "example.test", mode: "url" });
    assert.deepEqual(calls[1].params.slice(5), [null, null, null]);
  } finally { state.exportQuery = null; }
});

test("DB initialization runs twice with the same additive IF NOT EXISTS correlation DDL", async () => {
  const db = await loadAdminDb();
  const schemas = [];
  state.exportQuery = async sql => {
    if (sql.includes("CREATE TABLE IF NOT EXISTS analysis_log")) schemas.push(sql);
    return { rows: sql.includes("SELECT COUNT") ? [{ c: "1" }] : [] };
  };
  try {
    await db.initializeDatabase();
    await db.initializeDatabase();
    assert.equal(schemas.length, 2);
    assert.equal(schemas[0], schemas[1]);
    for (const [table, column] of [
      ["analysis_log", "prep_id"], ["analysis_log", "llm_provider"],
      ["analysis_log", "llm_model"], ["system_events", "prep_id"],
    ]) assert.ok(schemas[0].includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} TEXT`));
    assert.match(schemas[0], /CREATE INDEX IF NOT EXISTS idx_system_events_prep_id\s+ON system_events \(prep_id\)/);
    assert.match(schemas[0], /CREATE TABLE IF NOT EXISTS usage_events/);
    assert.match(schemas[0], /ALTER TABLE analysis_log ADD COLUMN IF NOT EXISTS usage_json JSONB/);
    for (const column of ["created_at", "analysis_id", "prep_id"]) {
      assert.ok(schemas[0].includes(`CREATE INDEX IF NOT EXISTS idx_usage_events_${column}`));
    }
  } finally { state.exportQuery = null; }
});
const {
  migrateLlmDiscoverabilityAPrompt, PREVIOUS_LLM_DISCOVERABILITY_A_TEMPLATE,
  removeLegacyLlmDiscoverabilityRatingPrompt, PREVIOUS_LLM_DISCOVERABILITY_RATING_TEMPLATE,
  saveAnalysisExportOnce,
  insertReportDelivery, countReportDeliveries,
  migrateReportDeliveryRetention, REPORT_DELIVERY_RETENTION_MIGRATION,
} = await loadAdminDb();

function reset(template) {
  state.template = template;
  state.logs = [];
  state.updates = [];
  state.deletes = [];
  state.cleared = [];
}

test("migrates only the verbatim previous Part A default", async () => {
  reset(PREVIOUS_LLM_DISCOVERABILITY_A_TEMPLATE);
  await migrateLlmDiscoverabilityAPrompt();

  assert.equal(state.template, "updated default template");
  assert.equal(state.updates.length, 1);
  assert.deepEqual(state.updates[0].slice(1, 4), [
    "updated description",
    JSON.stringify([{ key: "{{COMBINED_CONTENT}}", description: "unchanged placeholder" }]),
    "llm-discoverability-a",
  ]);
  assert.ok(state.logs.some(({ level, msg }) => level === "info" && msg === "llm-discoverability-a prompt migrated"));
  assert.deepEqual(state.cleared, ["llm-discoverability-a"]);
});

test("leaves a customized Part A template unchanged and warns", async () => {
  reset("Custom admin-edited prompt");
  await migrateLlmDiscoverabilityAPrompt();

  assert.equal(state.template, "Custom admin-edited prompt");
  assert.equal(state.updates.length, 1);
  assert.ok(state.logs.some(({ level, msg }) =>
    level === "warn" && msg === "llm-discoverability-a prompt customized – not migrated"));
  assert.deepEqual(state.cleared, ["llm-discoverability-a"]);
});

test("removes only the verbatim legacy rating prompt and logs its deletion", async () => {
  reset(PREVIOUS_LLM_DISCOVERABILITY_RATING_TEMPLATE);
  await removeLegacyLlmDiscoverabilityRatingPrompt();
  assert.equal(state.template, null);
  assert.equal(state.deletes.length, 1);
  assert.match(state.deletes[0].sql, /WHERE slug = 'llm-discoverability-rating' AND template = \$1 RETURNING slug/);
  assert.deepEqual(state.deletes[0].params, [PREVIOUS_LLM_DISCOVERABILITY_RATING_TEMPLATE]);
  assert.deepEqual(state.logs, [{ level: "info", msg: "legacy llm-discoverability-rating prompt removed" }]);
  assert.deepEqual(state.cleared, ["llm-discoverability-rating"]);
});

test("keeps a customized legacy rating prompt and warns", async () => {
  reset("Custom legacy rating prompt");
  await removeLegacyLlmDiscoverabilityRatingPrompt();
  assert.equal(state.template, "Custom legacy rating prompt");
  assert.deepEqual(state.logs, [{ level: "warn", msg: "legacy llm-discoverability-rating prompt customized – not removed" }]);
  assert.deepEqual(state.cleared, ["llm-discoverability-rating"]);
});

test("does nothing when the legacy prompt is absent, including on repeat startup", async () => {
  reset(null);
  await removeLegacyLlmDiscoverabilityRatingPrompt();
  await removeLegacyLlmDiscoverabilityRatingPrompt();
  assert.equal(state.template, null);
  assert.deepEqual(state.logs, []);
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.cleared, ["llm-discoverability-rating", "llm-discoverability-rating"]);
});

test("prompt defaults no longer contain the legacy rating slug", async () => {
  const { outputFiles } = await build({
    entryPoints: [new URL("./prompt-defaults.ts", import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", write: false,
  });
  const { PROMPT_DEFAULTS } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
  assert.ok(!PROMPT_DEFAULTS.some(({ slug }) => slug === "llm-discoverability-rating"));
  assert.ok(PROMPT_DEFAULTS.some(({ slug }) => slug === "llm-discoverability-rating-v2"));
});

function exportDatabase() {
  const db = { exports: new Map(), linked: null, nextId: 1, calls: [] };
  state.exportQuery = async (sql, params) => {
    db.calls.push([sql, params]);
    await Promise.resolve(); // Allow overlapping inserts before the guarded updates.
    const statement = sql.replace(/\s+/g, " ");
    if (statement.includes("INSERT INTO analysis_exports")) {
      const id = db.nextId++;
      db.exports.set(id, { logId: params[0], html: params[1] });
      return { rows: [{ id }] };
    }
    if (statement.includes("UPDATE analysis_log")) {
      assert.match(statement, /WHERE id = \$2 AND html_export_id IS NULL RETURNING id/);
      assert.equal(params[1], 42);
      if (db.linked !== null) return { rows: [] };
      db.linked = params[0];
      return { rows: [{ id: 42 }] };
    }
    if (statement === "DELETE FROM analysis_exports WHERE id = $1") {
      db.exports.delete(params[0]);
      return { rows: [] };
    }
    throw new Error(`Unexpected export SQL: ${sql}`);
  };
  return db;
}

test("saveAnalysisExportOnce skips a second call and deletes the newly inserted orphan", async () => {
  const db = exportDatabase();
  try {
    const first = await saveAnalysisExportOnce(42, "original");
    const second = await saveAnalysisExportOnce(42, "replacement");
    assert.equal(first, 1);
    assert.equal(second, null);
    assert.equal(db.linked, first);
    assert.deepEqual([...db.exports], [[1, { logId: 42, html: "original" }]]);
    assert.equal(db.calls.filter(([sql]) => sql.includes("DELETE FROM analysis_exports")).length, 1);
    assert.deepEqual(db.calls.at(-1)[1], [2]);
  } finally {
    delete state.exportQuery;
  }
});

test("saveAnalysisExportOnce concurrent calls have one winner and leave no orphan row", async () => {
  const db = exportDatabase();
  try {
    const results = await Promise.all([
      saveAnalysisExportOnce(42, "first"),
      saveAnalysisExportOnce(42, "second"),
    ]);
    const winners = results.filter(id => id !== null);
    assert.equal(winners.length, 1);
    assert.equal(results.filter(id => id === null).length, 1);
    assert.equal(db.linked, winners[0]);
    assert.equal(db.exports.size, 1);
    assert.ok(db.exports.has(winners[0]));
    assert.equal(db.calls.filter(([sql]) => sql.includes("INSERT INTO analysis_exports")).length, 2);
    assert.equal(db.calls.filter(([sql]) => sql.includes("DELETE FROM analysis_exports")).length, 1);
  } finally {
    delete state.exportQuery;
  }
});

test("insertReportDelivery timestamps consent in SQL only for true and never stores false-consent text or attachments", async () => {
  const calls = [];
  state.exportQuery = async (sql, params) => {
    calls.push([sql, params]);
    return { rows: [{ id: 12 }] };
  };
  try {
    const delivery = {
      analysisLogId: 42, analysisUuid: "uuid", recipientEmail: "customer@example.test",
      reportType: "html", domain: "https://server.test", companyName: "Server", gaioScore: 67,
      consentMarketing: true, consentText: "Exact label", status: "sent", errorMessage: null,
    };
    assert.equal(await insertReportDelivery(delivery), 12);
    assert.match(calls[0][0], /CASE WHEN \$8 THEN NOW\(\) ELSE NULL END/);
    assert.deepEqual(calls[0][1], [42, "uuid", "customer@example.test", "html", "https://server.test", "Server", 67, true, "Exact label", "sent", null]);
    await insertReportDelivery({ ...delivery, consentMarketing: false, status: "failed", errorMessage: "SMTP failure" });
    assert.equal(calls[1][1][7], false);
    assert.equal(calls[1][1][8], null);
    assert.deepEqual(calls[1][1].slice(9), ["failed", "SMTP failure"]);
    assert.ok(!calls[0][0].includes("html_content"));
  } finally {
    delete state.exportQuery;
  }
});

test("countReportDeliveries counts all delivery statuses for only the given analysis log", async () => {
  state.exportQuery = async (sql, params) => {
    assert.equal(sql, "SELECT COUNT(*)::int AS count FROM report_deliveries WHERE analysis_log_id = $1");
    assert.deepEqual(params, [42]);
    return { rows: [{ count: 5 }] };
  };
  try {
    assert.equal(await countReportDeliveries(42), 5);
  } finally {
    delete state.exportQuery;
  }
});

test("delivery retention migration is repeatable, guards the FK delete action and changes only report_deliveries", async () => {
  const calls = [];
  state.exportQuery = async sql => { calls.push(sql); return { rows: [] }; };
  try {
    await migrateReportDeliveryRetention();
    await migrateReportDeliveryRetention();
    assert.deepEqual(calls, [REPORT_DELIVERY_RETENTION_MIGRATION, REPORT_DELIVERY_RETENTION_MIGRATION]);
    const sql = calls[0];
    assert.match(sql, /DO \$\$/);
    assert.match(sql, /ALTER TABLE public\.report_deliveries ALTER COLUMN analysis_log_id DROP NOT NULL/);
    assert.match(sql, /FROM pg_constraint c/);
    assert.match(sql, /c\.conkey = ARRAY\[a\.attnum\]/);
    assert.match(sql, /a\.attname = 'analysis_log_id'/);
    assert.match(sql, /IF fk\.confdeltype <> 'n' THEN/);
    assert.match(sql, /DROP CONSTRAINT %I/);
    assert.match(sql, /REFERENCES public\.analysis_log\(id\) ON DELETE SET NULL/);
    assert.ok(!/\b(UPDATE|DELETE FROM|TRUNCATE|INSERT INTO)\b/.test(sql));
    assert.deepEqual([...sql.matchAll(/ALTER TABLE (\S+)/g)].map(match => match[1]),
      ["public.report_deliveries", "public.report_deliveries", "public.report_deliveries"]);
    const source = await readFile(new URL("./admin-db.ts", import.meta.url), "utf8");
    assert.match(source, /analysis_log_id INTEGER REFERENCES analysis_log\(id\) ON DELETE SET NULL/);
    assert.match(source, /await query\(CREATE_TABLES\);\s*await migrateReportDeliveryRetention\(\);/);
  } finally {
    delete state.exportQuery;
  }
});