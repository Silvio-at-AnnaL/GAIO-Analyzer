import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  react: `
    export function useState(initial) {
      const h = globalThis.__deliveryUiHarness, i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
      return [h.slots[i], value => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }];
    }
    export function useRef(current) {
      const h = globalThis.__deliveryUiHarness, i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = { current };
      return h.slots[i];
    }
    function changed(a, b) { return !a || b.some((value, i) => !Object.is(value, a[i])); }
    export function useCallback(fn, deps) {
      const h = globalThis.__deliveryUiHarness, i = h.cursor++;
      if (changed(h.dependencies[i], deps)) { h.dependencies[i] = deps; h.slots[i] = fn; }
      return h.slots[i];
    }
    export function useEffect(fn, deps) {
      const h = globalThis.__deliveryUiHarness, i = h.cursor++;
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
    export function useAuth() { return globalThis.__deliveryUiHarness.auth; }
    export function canAccess(feature, role, permissions) {
      return role === "admin" || (permissions[feature] ?? ["admin"]).includes(role);
    }
    export async function adminFetch(url, options) {
      const h = globalThis.__deliveryUiHarness;
      h.calls.push([url, options]);
      return h.api(url, options);
    }
  `,
  "@/store/appStore": `export function useAppStore() { return { setActiveView() {} }; }`,
  "@/lib/LabelProvider": `
    const t = key => key;
    export function useT() { return t; }
    export function useLabelContext() { return { locale: "de" }; }
  `,
  "lucide-react": `
    export const Download = "Download", Trash2 = "Trash2", Inbox = "Inbox",
      ChevronLeft = "ChevronLeft", ChevronRight = "ChevronRight";
  `,
};
const { outputFiles } = await build({
  entryPoints: [new URL("../views/admin/DeliveryLogView.tsx", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false,
  define: {
    setTimeout: "globalThis.__deliveryUiHarness.setTimeout",
    clearTimeout: "globalThis.__deliveryUiHarness.clearTimeout",
  },
  plugins: [{
    name: "delivery-view-mocks",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: "delivery-ui-mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "delivery-ui-mock" }, args => ({
        contents: mocks[args.path], loader: "js",
      }));
    },
  }],
});
const { DeliveryLogView } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}
const find = (root, id) => elements(root, node => node.props?.["data-testid"] === id)[0];
const item = {
  id: 7, createdAt: "2026-10-14T06:30:00Z", recipientEmail: "lead@example.test",
  companyName: "Acme", domain: null, gaioScore: 71, reportType: "html",
  consentMarketing: true, consentAt: "2026-10-14T06:30:00Z", consentText: "Exact consent",
  status: "sent", errorMessage: null, analysisLogId: 42, hasReport: true,
};
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function harness(role = "user_extended", granted = true) {
  const h = {
    cursor: 0, slots: [], dependencies: [], effects: [], cleanups: [], timers: new Map(),
    timerId: 0, calls: [], rows: [{ ...item }], downloads: [], blobs: [],
    auth: { isLoading: false, isAuthenticated: true, user: { id: 3, role },
      permissions: granted ? { versandprotokoll: ["user_extended"] } : {} },
    setTimeout(fn) { const id = ++h.timerId; h.timers.set(id, fn); return id; },
    clearTimeout(id) { h.timers.delete(id); },
    async api(url, options) {
      if (options?.method === "DELETE") { h.rows = []; return json({ ok: true }); }
      if (url.includes("export.csv")) return new Response("\uFEFFheader\r\nvalue\r\n", {
        headers: { "Content-Disposition": 'attachment; filename="versandprotokoll_2026-10-14.csv"' },
      });
      if (url.endsWith("/report")) return new Response("<html>Saved report</html>", {
        headers: { "Content-Disposition": 'attachment; filename="GAIO-acme-20261014.html"' },
      });
      return json({ items: h.rows, total: h.rows.length, page: Number(new URL(url, "https://test").searchParams.get("page")), pages: h.rows.length ? 1 : 0 });
    },
  };
  globalThis.__deliveryUiHarness = h;
  h.render = () => {
    h.cursor = 0; h.root = DeliveryLogView();
    h.effects.splice(0).forEach(effect => effect());
    return h.root;
  };
  h.settle = async () => {
    for (let i = 0; i < 5; i++) { h.render(); await new Promise(resolve => setImmediate(resolve)); }
    return h.root;
  };
  h.flushTimers = () => {
    const pending = [...h.timers.values()]; h.timers.clear(); pending.forEach(fn => fn());
  };
  return h;
}
async function withDownloads(h, fn) {
  const savedDocument = globalThis.document, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  globalThis.document = { createElement() {
    const anchor = { click() { h.downloads.push(anchor.download); } };
    return anchor;
  } };
  URL.createObjectURL = blob => { h.blobs.push(blob); return "blob:fixture"; };
  URL.revokeObjectURL = () => {};
  try { await fn(); } finally {
    if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument;
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  }
}

test("delegated delivery view loads rows, shows consent tooltip and handles nullable domains", async () => {
  const h = harness();
  await h.settle();
  assert.ok(find(h.root, "row-delivery-7"));
  assert.ok(elements(h.root, node => node.props?.title === "Exact consent").length);
  assert.equal(h.calls[0][0], "/api/admin/report-deliveries?page=1&limit=25");
  await withDownloads(h, async () => {
    await find(h.root, "button-report-7").props.onClick();
    assert.deepEqual(h.downloads, ["GAIO-acme-20261014.html"]);
    assert.equal(await h.blobs[0].text(), "<html>Saved report</html>");
  });
});

test("delivery view denies unlisted roles without fetching and hides downloads for unlinked rows", async () => {
  const denied = harness("user", false);
  await denied.settle();
  assert.equal(denied.calls.length, 0);
  assert.ok(!find(denied.root, "row-delivery-7"));
  const h = harness("admin", false);
  h.rows[0] = { ...item, analysisLogId: null, hasReport: false };
  await h.settle();
  assert.ok(find(h.root, "row-delivery-7"));
  assert.equal(find(h.root, "button-report-7"), undefined);
});

test("search and consent interactions drive list requests and CSV uses current search before debounce", async () => {
  const h = harness();
  await h.settle();
  find(h.root, "input-search").props.onChange({ target: { value: "  Acme & Co  " } });
  find(h.root, "toggle-consent-only").props.onChange({ target: { checked: true } });
  await h.settle();
  await withDownloads(h, async () => {
    await find(h.root, "button-export-csv").props.onClick();
    const request = h.calls.find(([url]) => url.includes("export.csv"))[0];
    const params = new URL(request, "https://test").searchParams;
    assert.equal(params.get("q"), "Acme & Co");
    assert.equal(params.get("consent"), "only");
    assert.deepEqual(h.downloads, ["versandprotokoll_2026-10-14.csv"]);
    assert.deepEqual([...new Uint8Array(await h.blobs[0].arrayBuffer()).slice(0, 3)], [239, 187, 191]);
  });
  h.flushTimers();
  await h.settle();
  const params = new URL(h.calls.at(-1)[0], "https://test").searchParams;
  assert.equal(params.get("q"), "Acme & Co");
  assert.equal(params.get("consent"), "only");
  assert.equal(params.get("page"), "1");
});

test("delivery delete requires confirmation, sends only the delivery ID and refreshes the list", async () => {
  const h = harness();
  await h.settle();
  find(h.root, "button-delete-7").props.onClick();
  await h.settle();
  assert.ok(find(h.root, "button-delete-confirm"));
  assert.equal(h.calls.filter(([, options]) => options?.method === "DELETE").length, 0);
  await find(h.root, "button-delete-confirm").props.onClick();
  await h.settle();
  assert.deepEqual(h.calls.find(([, options]) => options?.method === "DELETE"),
    ["/api/admin/report-deliveries/7", { method: "DELETE" }]);
  assert.equal(find(h.root, "row-delivery-7"), undefined);
  assert.equal(find(h.root, "button-delete-confirm"), undefined);
  assert.ok(find(h.root, "deliverylog-empty"));
});

test("download and deletion failures are visible and do not delete the displayed row", async () => {
  const h = harness();
  await h.settle();
  const original = h.api;
  h.api = (url, options) => options?.method === "DELETE" || url.includes("export.csv") || url.endsWith("/report")
    ? new Response("failed", { status: 500 }) : original(url, options);
  await find(h.root, "button-export-csv").props.onClick();
  await h.settle();
  assert.ok(find(h.root, "deliverylog-action-error"));
  find(h.root, "button-delete-7").props.onClick();
  await h.settle();
  await find(h.root, "button-delete-confirm").props.onClick();
  await h.settle();
  assert.ok(find(h.root, "button-delete-confirm"));
  assert.ok(find(h.root, "row-delivery-7"));
});

test("changing sessions reloads delivery data and discards an old report download", async () => {
  const h = harness();
  await h.settle();
  const original = h.api;
  let release;
  h.api = (url, options) => url.endsWith("/report") ? new Promise(resolve => { release = resolve; }) : original(url, options);
  await withDownloads(h, async () => {
    const pending = find(h.root, "button-report-7").props.onClick();
    const before = h.calls.length;
    h.auth = { ...h.auth, user: { id: 4, role: "user_extended" } };
    await h.settle();
    assert.ok(h.calls.length > before);
    release(new Response("<html>old session</html>"));
    await pending;
    assert.deepEqual(h.downloads, []);
  });
});
