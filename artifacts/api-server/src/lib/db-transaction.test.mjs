import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./bootstrap.js": `export function resolveDatabaseConfig() { return { url: "postgresql://fixture/db", source: "env" }; }`,
  pg: `
    export default {
      types: { builtins: { TIMESTAMP: 1, TIMESTAMPTZ: 2, DATE: 3 }, setTypeParser() {} },
      Pool: class {
        on() {}
        async connect() {
          globalThis.__transactionTest.connects++;
          return globalThis.__transactionTest.client;
        }
      }
    };
  `,
  "./logger.js": `export const logger = { warn() {}, error(...args) {
    globalThis.__transactionTest.errors.push(args);
  } };`,
};
const { outputFiles } = await build({
  entryPoints: [new URL("./db.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "transaction-mocks",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args =>
        Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "transaction-mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "transaction-mock" }, args => ({
        contents: mocks[args.path], loader: "js",
      }));
    },
  }],
});
const { withTransaction } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

function database(failOn) {
  const state = { connects: 0, calls: [], releases: [], errors: [], exportExists: true, logExists: true };
  let snapshot;
  state.client = {
    async query(sql) {
      state.calls.push(sql);
      if (sql === failOn) throw new Error(`Failed: ${sql}`);
      if (sql === "BEGIN") snapshot = { exportExists: state.exportExists, logExists: state.logExists };
      if (sql === "DELETE exports") state.exportExists = false;
      if (sql === "DELETE log") state.logExists = false;
      if (sql === "ROLLBACK") Object.assign(state, snapshot);
      return { rows: [] };
    },
    release(error) { state.releases.push(error); },
  };
  globalThis.__transactionTest = state;
  return state;
}

test("withTransaction commits on one pooled client, returns the result and releases once", async () => {
  const state = database();
  const result = await withTransaction(async client => {
    assert.equal(client, state.client);
    await client.query("DELETE exports");
    await client.query("DELETE log");
    return "done";
  });
  assert.equal(result, "done");
  assert.equal(state.connects, 1);
  assert.deepEqual(state.calls, ["BEGIN", "DELETE exports", "DELETE log", "COMMIT"]);
  assert.deepEqual(state.releases, [undefined]);
  assert.equal(state.exportExists, false);
  assert.equal(state.logExists, false);
});

test("withTransaction rolls back failed second statements without leaving the export deleted", async () => {
  const state = database("DELETE log");
  await assert.rejects(() => withTransaction(async client => {
    await client.query("DELETE exports");
    await client.query("DELETE log");
  }), /Failed: DELETE log/);
  assert.equal(state.connects, 1);
  assert.deepEqual(state.calls, ["BEGIN", "DELETE exports", "DELETE log", "ROLLBACK"]);
  assert.deepEqual(state.releases, [undefined]);
  assert.equal(state.exportExists, true);
  assert.equal(state.logExists, true);
});

test("withTransaction rolls back commit failures and releases the client", async () => {
  const state = database("COMMIT");
  await assert.rejects(() => withTransaction(async client => {
    await client.query("DELETE exports");
  }), /Failed: COMMIT/);
  assert.deepEqual(state.calls, ["BEGIN", "DELETE exports", "COMMIT", "ROLLBACK"]);
  assert.equal(state.exportExists, true);
  assert.deepEqual(state.releases, [undefined]);
});

test("withTransaction preserves the original error and discards the client if rollback fails", async () => {
  const state = database("ROLLBACK");
  const original = new Error("Original failure");
  await assert.rejects(() => withTransaction(async () => { throw original; }), err => err === original);
  assert.deepEqual(state.calls, ["BEGIN", "ROLLBACK"]);
  assert.equal(state.releases.length, 1);
  assert.match(state.releases[0].message, /Failed: ROLLBACK/);
  assert.equal(state.errors.length, 1);
});
