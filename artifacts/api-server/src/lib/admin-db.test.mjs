import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

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
  "bcryptjs": `export default { hash: async () => "not-used" };`,
  "./db.js": `
    export async function query(sql, params) {
      const state = globalThis.__adminDbMigrationTest;
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
const {
  migrateLlmDiscoverabilityAPrompt, PREVIOUS_LLM_DISCOVERABILITY_A_TEMPLATE,
  removeLegacyLlmDiscoverabilityRatingPrompt, PREVIOUS_LLM_DISCOVERABILITY_RATING_TEMPLATE,
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