import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  react: `
    export function createContext() { return { Provider: "auth-provider" }; }
    export function useContext() {}
    export function useState(initial) {
      const h = globalThis.__authRetryHarness, i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
      return [h.slots[i], value => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }];
    }
    export function useEffect() {}
    export function useCallback(fn) { return fn; }
  `,
  "react/jsx-runtime": `
    export function jsx(type, props) { return { type, props }; }
    export const jsxs = jsx;
  `,
};
const { outputFiles } = await build({
  entryPoints: [new URL("../store/authStore.tsx", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false,
  define: { "import.meta.env.BASE_URL": '"/"' },
  plugins: [{
    name: "auth-retry-fixtures",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: "auth-retry" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "auth-retry" }, args => ({
        contents: mocks[args.path], loader: "js",
      }));
    },
  }],
});
const { AuthProvider } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const user = { id: 1, username: "fixture", role: "admin" };

function harness(context, statuses) {
  const h = { slots: [], cursor: 0, calls: [] };
  globalThis.__authRetryHarness = h;
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.mock.method(globalThis, "fetch", async (url, init) => {
    h.calls.push([url, init]);
    if (url.endsWith("/permissions")) return Response.json({ mailserver: ["admin"] });
    const status = statuses.shift();
    assert.ok(status, "unexpected extra /me request");
    if (status instanceof Error) throw status;
    return Response.json(status === 200 ? { user } : { errorLabel: "auth.session_unavailable" }, { status });
  });
  h.render = () => {
    h.cursor = 0;
    h.value = AuthProvider({ children: null }).props.value;
  };
  h.meCalls = () => h.calls.filter(([url]) => url.endsWith("/me"));
  h.render();
  return h;
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

test("refreshUser retries /me exactly once after 2 seconds on 503 and preserves a recovered login", async context => {
  const h = harness(context, [503, 200]);
  const pending = h.value.refreshUser();
  await flush();
  h.render();
  assert.equal(h.meCalls().length, 1);
  assert.equal(h.value.isLoading, true);
  context.mock.timers.tick(1_999);
  await flush();
  assert.equal(h.meCalls().length, 1);
  context.mock.timers.tick(1);
  await pending;
  h.render();
  assert.equal(h.meCalls().length, 2);
  assert.equal(h.value.isLoading, false);
  assert.equal(h.value.isAuthenticated, true);
  assert.deepEqual(h.value.user, user);
  assert.deepEqual(h.value.permissions, { mailserver: ["admin"] });
  assert.ok(h.meCalls().every(([, init]) => init.credentials === "include"));
});

test("refreshUser logs out after a second 503 without scheduling further retries", async context => {
  const h = harness(context, [503, 503]);
  h.value.login(user);
  const pending = h.value.refreshUser();
  await flush();
  h.render();
  assert.equal(h.value.isAuthenticated, true, "retain the current user while waiting for retry");
  context.mock.timers.tick(2_000);
  await pending;
  context.mock.timers.tick(20_000);
  await flush();
  h.render();
  assert.equal(h.meCalls().length, 2);
  assert.equal(h.value.isAuthenticated, false);
  assert.deepEqual(h.value.permissions, {});
});

test("refreshUser keeps non-503 HTTP handling unchanged without retries", async context => {
  for (const status of [401, 403, 500, 200]) {
    const h = harness(context, [status]);
    await h.value.refreshUser();
    context.mock.timers.tick(20_000);
    h.render();
    assert.equal(h.meCalls().length, 1, `status ${status}`);
    assert.equal(h.value.isAuthenticated, status === 200);
    assert.equal(h.value.isLoading, false);
    context.mock.timers.reset();
    context.mock.restoreAll();
  }
});

test("refreshUser handles a 401 retry response as logged out", async context => {
  const h = harness(context, [503, 401]);
  const pending = h.value.refreshUser();
  await flush();
  context.mock.timers.tick(2_000);
  await pending;
  h.render();
  assert.equal(h.meCalls().length, 2);
  assert.equal(h.value.isAuthenticated, false);
});

test("refreshUser preserves network-error handling without an HTTP retry", async context => {
  const h = harness(context, [new Error("Network unavailable")]);
  await h.value.refreshUser();
  context.mock.timers.tick(20_000);
  h.render();
  assert.equal(h.meCalls().length, 1);
  assert.equal(h.value.isLoading, false);
  assert.equal(h.value.isAuthenticated, false);
});
