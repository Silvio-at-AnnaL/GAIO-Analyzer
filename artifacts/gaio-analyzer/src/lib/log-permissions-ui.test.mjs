import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const authSource = await readFile(new URL("../store/authStore.tsx", import.meta.url), "utf8");
const accessFunction = authSource.match(/export function canAccess\([\s\S]*?\n\}/)[0];
const mocks = {
  react: `
    export const Fragment = "fragment";
    export function useState(initial) {
      const h = globalThis.__logUiHarness, i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
      return [h.slots[i], value => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }];
    }
    export function useRef(current) {
      const h = globalThis.__logUiHarness, i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = { current };
      return h.slots[i];
    }
    function changed(a, b) { return !a || b.some((value, i) => !Object.is(value, a[i])); }
    export function useCallback(fn, deps) {
      const h = globalThis.__logUiHarness, i = h.cursor++;
      if (changed(h.dependencies[i], deps)) { h.dependencies[i] = deps; h.slots[i] = fn; }
      return h.slots[i];
    }
    export function useEffect(fn, deps) {
      const h = globalThis.__logUiHarness, i = h.cursor++;
      if (changed(h.dependencies[i], deps)) {
        h.dependencies[i] = deps;
        h.effects.push(() => { h.cleanups[i]?.(); h.cleanups[i] = fn(); });
      }
    }
  `,
  "react/jsx-runtime": `
    export function jsx(type, props, key) { return { type, props: props ?? {}, key }; }
    export const jsxs = jsx; export const Fragment = "fragment";
  `,
  "@/store/authStore": `
    ${accessFunction}
    export function useAuth() { return globalThis.__logUiHarness.auth; }
    export async function adminFetch(url, options) {
      const h = globalThis.__logUiHarness;
      h.calls.push([url, options]);
      return h.api(url, options);
    }
  `,
  "@/store/appStore": `
    export function useAppStore() {
      const h = globalThis.__logUiHarness;
      return { setActiveView: value => h.navigation.push(value), setSystemLogAnalysisId: value => h.analysisIds.push(value) };
    }
  `,
  "@/lib/LabelProvider": `
    const t = key => key;
    export function useT() { return t; }
    export function useLabelContext() { return { locale: "de" }; }
  `,
  "lucide-react": `
    export const Download = "icon", Trash2 = "icon", ChevronLeft = "icon",
      ChevronRight = "icon", ScrollText = "icon", ChevronDown = "icon", ChevronUp = "icon";
  `,
};
async function load(view) {
  const { outputFiles } = await build({
    entryPoints: [new URL(`../views/admin/${view}.tsx`, import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false,
    define: {
      window: "globalThis.__logUiHarness.window",
      setTimeout: "globalThis.__logUiHarness.setTimeout",
      clearTimeout: "globalThis.__logUiHarness.clearTimeout",
    },
    plugins: [{
      name: "log-permission-view-mocks",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
          ? { path: args.path, namespace: "log-ui-mock" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "log-ui-mock" }, args => ({
          contents: mocks[args.path], loader: "ts",
        }));
      },
    }],
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`))[view];
}
const AnalysisLogView = await load("AnalysisLogView");
const SystemLogView = await load("SystemLogView");
const item = {
  id: 42, analysisUuid: "analysis-id", domain: "example.test", companyName: "Example Company",
  triggeredBy: "admin", gaioScore: 71, scoresJson: null, pagesCrawled: 3,
  status: "completed", errorMessage: null, startedAt: "2026-10-14T06:30:00Z",
  completedAt: "2026-10-14T06:31:00Z", hasHtmlExport: true,
};
const event = {
  id: "7", createdAt: "2026-10-14T06:30:00Z", level: 40, msg: "Fixture system event",
  analysisId: "analysis-id", analysisDomain: "example.test", context: null,
};
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function harness(view, role = "user_extended", permissions = {}) {
  const h = {
    cursor: 0, slots: [], dependencies: [], effects: [], cleanups: [], timers: new Map(), timerId: 0,
    calls: [], navigation: [], analysisIds: [], rows: [{ ...item }], events: [{ ...event }],
    window: { location: { search: "" } },
    auth: { isLoading: false, isAuthenticated: !!role, user: role ? { id: 3, role } : null, permissions },
    setTimeout(fn) { const id = ++h.timerId; h.timers.set(id, fn); return id; },
    clearTimeout(id) { h.timers.delete(id); },
    async api(url, options) {
      if (options?.method === "DELETE") { h.rows = []; return json({ ok: true }); }
      if (url.endsWith("/export")) return new Response("<html>Saved report</html>");
      if (url.includes("analysis-log?")) return json({
        items: h.rows, total: h.rows.length, page: 1, pages: h.rows.length ? 1 : 0, storageTotalKb: 12,
      });
      return json({ events: h.events, nextBeforeId: null });
    },
  };
  globalThis.__logUiHarness = h;
  h.render = () => {
    h.cursor = 0;
    h.root = view === SystemLogView ? view({}) : view();
    h.effects.splice(0).forEach(effect => effect());
    return h.root;
  };
  h.settle = async () => {
    for (let i = 0; i < 5; i++) { h.render(); await new Promise(resolve => setImmediate(resolve)); }
    return h.root;
  };
  return h;
}
function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!node || typeof node !== "object") return [];
  if (typeof node.type === "function") return elements(node.type(node.props), predicate);
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}
function hasText(node, text) {
  if (node === text) return true;
  if (Array.isArray(node)) return node.some(child => hasText(child, text));
  return !!node && typeof node === "object" && hasText(node.props?.children, text);
}
const find = (root, id) => elements(root, node => node.props?.["data-testid"] === id)[0];

for (const [view, feature, title, denied, rowText, prefix] of [
  [AnalysisLogView, "analyseprotokoll", "nav.admin_analyseprotokoll", "log.no_access", item.companyName, "/api/admin/analysis-log?"],
  [SystemLogView, "systemprotokoll", "systemlog.title", "systemlog.error", event.msg, "/api/admin/system-events?"],
]) {
  test(`${feature} renders granted extended/basic users and admins, but denies absent grants and anonymous users`, async () => {
    for (const [role, grant, expected] of [
      ["user_extended", true, true], ["user_extended", false, false],
      ["user", true, true], ["user", false, false], ["admin", false, true], [null, true, false],
    ]) {
      const h = harness(view, role, grant ? { [feature]: ["user_extended", "user"] } : {});
      await h.settle();
      assert.equal(hasText(h.root, title), expected);
      assert.equal(hasText(h.root, rowText), expected);
      assert.equal(hasText(h.root, denied), !expected);
      assert.equal(h.calls.length, expected ? 1 : 0);
      if (expected) assert.ok(h.calls[0][0].startsWith(prefix));
    }
  });
}

test("analysis and system log permissions are independent", async () => {
  for (const [view, otherFeature] of [[AnalysisLogView, "systemprotokoll"], [SystemLogView, "analyseprotokoll"]]) {
    const h = harness(view, "user_extended", { [otherFeature]: ["user_extended"] });
    await h.settle();
    assert.equal(h.calls.length, 0);
    assert.ok(!hasText(h.root, item.companyName));
    assert.ok(!hasText(h.root, event.msg));
  }
});

test("analysis-row system-log links require their separate permission and preserve navigation", async () => {
  const h = harness(AnalysisLogView, "user_extended", { analyseprotokoll: ["user_extended"] });
  h.rows.push({ ...item, id: 43, analysisUuid: null });
  await h.settle();
  const links = () => elements(h.root, node => node.type === "button" && node.props?.title === "log.system_log_title");
  assert.equal(links().length, 0);
  h.auth.permissions = { ...h.auth.permissions, systemprotokoll: ["user_extended"] };
  await h.settle();
  assert.equal(links().length, 1);
  links()[0].props.onClick();
  assert.deepEqual(h.analysisIds, ["analysis-id"]);
  assert.deepEqual(h.navigation, [22]);
  h.auth.permissions = { analyseprotokoll: ["user_extended"] };
  await h.settle();
  assert.equal(links().length, 0);
  const admin = harness(AnalysisLogView, "admin");
  await admin.settle();
  assert.equal(elements(admin.root, node => node.props?.title === "log.system_log_title").length, 1);
});

test("changing permission grants updates both log gates and fetching", async () => {
  for (const [view, feature, denied, rowText] of [
    [AnalysisLogView, "analyseprotokoll", "log.no_access", item.companyName],
    [SystemLogView, "systemprotokoll", "systemlog.error", event.msg],
  ]) {
    const h = harness(view);
    await h.settle();
    assert.equal(h.calls.length, 0);
    h.auth.permissions = { [feature]: ["user_extended"] };
    await h.settle();
    assert.equal(h.calls.length, 1);
    assert.ok(hasText(h.root, rowText));
    h.auth.permissions = {};
    await h.settle();
    assert.equal(h.calls.length, 1);
    assert.ok(hasText(h.root, denied));
    assert.ok(!hasText(h.root, rowText));
    h.auth.permissions = { [feature]: ["user_extended"] };
    await h.settle();
    assert.equal(h.calls.length, 2);
    h.auth.user = { id: 3, role: "user" };
    await h.settle();
    assert.equal(h.calls.length, 2);
    assert.ok(hasText(h.root, denied));
  }
});

test("delegated analysis log preserves export and confirmed deletion", async () => {
  const h = harness(AnalysisLogView, "user_extended", { analyseprotokoll: ["user_extended"] });
  await h.settle();
  const oldDocument = globalThis.document, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const downloads = [], blobs = [];
  globalThis.document = { createElement() {
    const anchor = { click() { downloads.push(anchor.download); } };
    return anchor;
  } };
  URL.createObjectURL = blob => { blobs.push(blob); return "blob:fixture"; };
  URL.revokeObjectURL = () => {};
  try {
    await elements(h.root, node => node.props?.title === "log.export_title")[0].props.onClick();
    assert.deepEqual(downloads, ["GAIO-example.test-20261014.html"]);
    assert.equal(await blobs[0].text(), "<html>Saved report</html>");
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  }
  elements(h.root, node => node.props?.title === "log.delete_title")[0].props.onClick();
  await h.settle();
  assert.equal(h.calls.filter(([, options]) => options?.method === "DELETE").length, 0);
  await elements(h.root, node => node.type === "button" && hasText(node, "log.delete_button"))[0].props.onClick();
  await h.settle();
  assert.deepEqual(h.calls.find(([, options]) => options?.method === "DELETE"),
    ["/api/admin/analysis-log/42", { method: "DELETE" }]);
  assert.ok(!hasText(h.root, item.companyName));
});

test("delegated system log preserves analysis filters and severity filtering", async () => {
  const h = harness(SystemLogView, "user_extended", { systemprotokoll: ["user_extended"] });
  await h.settle();
  find(h.root, "input-filter-analysis").props.onChange({ target: { value: "analysis-id" } });
  find(h.root, "select-filter-severity").props.onChange({ target: { value: "30" } });
  await h.settle();
  elements(h.root, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} });
  await h.settle();
  const params = new URL(h.calls.at(-1)[0], "https://test").searchParams;
  assert.equal(params.get("analysisId"), "analysis-id");
  assert.equal(params.get("minLevel"), "30");
  assert.ok(hasText(h.root, event.msg));
});
