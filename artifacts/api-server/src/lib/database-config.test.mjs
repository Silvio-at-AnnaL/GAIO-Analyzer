import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
async function load(file, mocks, state, env = {}) {
  const { outputFiles } = await build({
    entryPoints: [new URL(file, import.meta.url).pathname],
    bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{
      name: "database-config-fixtures",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args =>
          Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
          contents: mocks[args.path], loader: "js",
        }));
      },
    }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", "fixture", "process", outputFiles[0].text)(
    require, module, module.exports, state, { env, cwd: () => "/fixture", exit: code => {
      state.exitCode = code;
      throw new Error("process exited");
    } },
  );
  return module.exports;
}

const bootstrapMocks = {
  "node:fs": `export function readFileSync() {
    fixture.reads++;
    if (fixture.error) throw fixture.error;
    return fixture.file;
  }`,
  "./logger.js": `export const logger = {
    warn(...args) { fixture.warnings.push(args); },
    fatal(...args) { fixture.fatal.push(args); }
  };`,
};
function configFixture(file = '{"database_url":" postgresql://fixture/file-db "}') {
  return { file, reads: 0, warnings: [], fatal: [] };
}

test("database resolver: trimmed environment wins without reading file", async () => {
  const state = configFixture();
  const mod = await load("./bootstrap.ts", bootstrapMocks, state, { DATABASE_URL: " postgresql://fixture/env-db " });
  assert.deepEqual(mod.resolveDatabaseConfig(), { url: "postgresql://fixture/env-db", source: "env" });
  assert.equal(state.reads, 0);
});

test("database resolver: file used with absent or whitespace-only environment", async () => {
  for (const env of [{}, { DATABASE_URL: " \n " }]) {
    const mod = await load("./bootstrap.ts", bootstrapMocks, configFixture(), env);
    assert.deepEqual(mod.resolveDatabaseConfig(), { url: "postgresql://fixture/file-db", source: "file" });
  }
});

test("database resolver: invalid/unreadable files ignored with content-free warning", async () => {
  for (const state of [
    configFixture("private-file-content: not JSON"),
    { ...configFixture(), error: Object.assign(new Error("private-file-content"), { code: "EACCES" }) },
    configFixture("null"),
    configFixture('{"database_url":17}'),
  ]) {
    const mod = await load("./bootstrap.ts", bootstrapMocks, state);
    assert.throws(() => mod.resolveDatabaseConfig(), /Refusing to start/);
    assert.ok(!JSON.stringify(state.warnings).includes("private-file-content"));
    if (state.file !== '{"database_url":17}') assert.equal(state.warnings.length, 1);
  }
});

test("database resolver: neither source throws; never uses PG variables", async () => {
  const state = configFixture();
  state.error = Object.assign(new Error("absent"), { code: "ENOENT" });
  const mod = await load("./bootstrap.ts", bootstrapMocks, state, {
    PGHOST: "localhost", PGUSER: "ignored", PGDATABASE: "ignored",
  });
  assert.throws(() => mod.resolveDatabaseConfig(), /DATABASE_URL is not set/);
  assert.equal(state.warnings.length, 0);
});

test("real pool uses the resolved file configuration and preserves pool options", async () => {
  const state = configFixture();
  const mod = await load("./db.ts", {
    ...bootstrapMocks,
    pg: `export default {
      types: { builtins: {}, setTypeParser() {} },
      Pool: class { constructor(options) { fixture.options = options; } on() {} }
    };`,
  }, state);
  assert.deepEqual(mod.databaseConfig, { url: "postgresql://fixture/file-db", source: "file" });
  assert.deepEqual(state.options, {
    connectionString: "postgresql://fixture/file-db",
    ssl: { rejectUnauthorized: false }, max: 10,
    idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000,
  });
});

test("real pool logs fatal and exits before constructing a pool without configuration", async () => {
  const state = configFixture("{}");
  await assert.rejects(load("./db.ts", {
    ...bootstrapMocks,
    pg: `export default { types: { builtins: {}, setTypeParser() {} }, Pool: class {
      constructor() { fixture.constructed = true; } } };`,
  }, state), /process exited/);
  assert.equal(state.exitCode, 1);
  assert.equal(state.fatal.length, 1);
  assert.equal(state.constructed, undefined);
});

const sessionMocks = {
  "./db.js": `export async function query(sql, params) {
    fixture.calls.push([sql, params]);
    if (fixture.queryGate) await fixture.queryGate;
    if (fixture.queryFailures > 0) { fixture.queryFailures--; throw new Error("Database temporarily unavailable"); }
    if (sql.startsWith("SELECT")) return { rows: fixture.stored === undefined ? [] : [{ value: fixture.stored }] };
    if (sql.startsWith("INSERT")) {
      fixture.candidates.push(params[1]);
      if (fixture.stored === undefined) fixture.stored = params[1];
      return { rows: [] };
    }
    throw new Error("Unexpected SQL");
  }`,
  "./admin-auth.js": `
    export function isSessionSigningReady() { return fixture.loaded.length > 0; }
    export function setSessionSigningSecret(value) { fixture.loaded.push(value); }
  `,
};
function secretFixture(stored) {
  return { stored, loaded: [], calls: [], candidates: [] };
}

test("session secret: existing stored row is used unchanged; environment is not consulted", async () => {
  const state = secretFixture("stored-winner");
  const env = Object.defineProperty({}, "ADMIN_JWT_SECRET", { get() { throw new Error("must not read env"); } });
  const mod = await load("./session-secret.ts", sessionMocks, state, env);
  await mod.initializeSessionSigningSecret();
  assert.deepEqual(state.loaded, ["stored-winner"]);
  assert.equal(state.candidates.length, 0);
  assert.ok(state.calls.every(([, params]) => params[0] === "session_signing_secret"));
});

test("session secret: missing row adopts SESSION_SECRET and reselects", async () => {
  const state = secretFixture();
  const mod = await load("./session-secret.ts", sessionMocks, state, { SESSION_SECRET: "session-fixture" });
  await mod.initializeSessionSigningSecret();
  assert.equal(state.stored, "session-fixture");
  assert.deepEqual(state.loaded, ["session-fixture"]);
  assert.match(state.calls[1][0], /ON CONFLICT \(key\) DO NOTHING/);
  assert.ok(state.calls[2][0].startsWith("SELECT"));
});

test("session secret: ADMIN_JWT_SECRET takes precedence only when inserting", async () => {
  const state = secretFixture();
  const mod = await load("./session-secret.ts", sessionMocks, state, {
    ADMIN_JWT_SECRET: "admin-fixture", SESSION_SECRET: "session-fixture",
  });
  await mod.initializeSessionSigningSecret();
  assert.deepEqual(state.loaded, ["admin-fixture"]);
});

test("session secret: missing environment generates a stored random 64-byte hex value", async () => {
  const state = secretFixture();
  const mod = await load("./session-secret.ts", sessionMocks, state);
  await mod.initializeSessionSigningSecret();
  assert.match(state.stored, /^[a-f0-9]{128}$/);
  assert.deepEqual(state.loaded, [state.stored]);
});

test("session secret: racing instances load one stored winner, never losing candidates", async () => {
  const state = secretFixture();
  const first = await load("./session-secret.ts", sessionMocks, state, { SESSION_SECRET: "instance-a" });
  const second = await load("./session-secret.ts", sessionMocks, state, { SESSION_SECRET: "instance-b" });
  await Promise.all([first.initializeSessionSigningSecret(), second.initializeSessionSigningSecret()]);
  assert.equal(state.candidates.length, 2);
  assert.equal(new Set(state.loaded).size, 1);
  assert.ok(state.loaded.every(value => value === state.stored));
});

test("ensure session signing shares one in-flight load and skips queries once ready", async () => {
  const state = secretFixture("stored-winner");
  let release;
  state.queryGate = new Promise(resolve => { release = resolve; });
  const mod = await load("./session-secret.ts", sessionMocks, state);
  const first = mod.ensureSessionSigningSecret();
  const second = mod.ensureSessionSigningSecret();
  const initialization = mod.initializeSessionSigningSecret();
  assert.equal(first, second);
  assert.equal(first, initialization);
  assert.equal(state.calls.length, 1);
  release();
  await Promise.all([first, second, initialization]);
  await mod.ensureSessionSigningSecret();
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.loaded, ["stored-winner"]);
});

test("ensure session signing clears a failed shared load so the next caller retries", async () => {
  const state = secretFixture("stored-winner");
  state.queryFailures = 1;
  const mod = await load("./session-secret.ts", sessionMocks, state);
  const first = mod.ensureSessionSigningSecret();
  const second = mod.ensureSessionSigningSecret();
  assert.equal(first, second);
  await assert.rejects(first, /temporarily unavailable/);
  assert.equal(state.calls.length, 1);
  await mod.ensureSessionSigningSecret();
  assert.equal(state.calls.length, 2);
  assert.deepEqual(state.loaded, ["stored-winner"]);
});

test("session tokens fail closed before initialization and use only the loaded secret afterwards", async () => {
  const env = {};
  const mod = await load("./admin-auth.ts", {}, {}, env);
  const payload = { userId: 1, username: "fixture", role: "admin" };
  assert.equal(mod.verifyToken("anything"), null);
  assert.equal(mod.isSessionSigningReady(), false);
  assert.throws(() => mod.signToken(payload), mod.SessionSecretNotReadyError);
  mod.setSessionSigningSecret("stored-fixture");
  env.SESSION_SECRET = "changed-environment";
  assert.equal(mod.verifyToken(mod.signToken(payload)).userId, 1);
  assert.equal(mod.isSessionSigningReady(), true);
});
