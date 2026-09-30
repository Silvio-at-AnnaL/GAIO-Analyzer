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

const state = { template: "", logs: [], updates: [], cleared: [] };
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
        return { rows: [{ template: state.template }] };
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
const { migrateLlmDiscoverabilityAPrompt, PREVIOUS_LLM_DISCOVERABILITY_A_TEMPLATE } = await loadAdminDb();

function reset(template) {
  state.template = template;
  state.logs = [];
  state.updates = [];
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