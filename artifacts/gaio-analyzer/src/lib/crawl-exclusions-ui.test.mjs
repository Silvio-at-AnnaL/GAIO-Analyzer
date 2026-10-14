import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  react: `
    export function useState(initial) {
      const h = globalThis.__exclUiHarness, i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
      return [h.slots[i], value => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }];
    }
    export function useRef(current) {
      const h = globalThis.__exclUiHarness, i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = { current };
      return h.slots[i];
    }
    function changed(a, b) { return !a || b.some((value, i) => !Object.is(value, a[i])); }
    export function useCallback(fn, deps) {
      const h = globalThis.__exclUiHarness, i = h.cursor++;
      if (changed(h.dependencies[i], deps)) { h.dependencies[i] = deps; h.slots[i] = fn; }
      return h.slots[i];
    }
    export function useEffect(fn, deps) {
      const h = globalThis.__exclUiHarness, i = h.cursor++;
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
    export function useAuth() { return globalThis.__exclUiHarness.auth; }
    export function canAccess(feature, role, permissions) {
      return role === "admin" || (permissions[feature] ?? ["admin"]).includes(role);
    }
    export async function adminFetch(url, options) {
      const h = globalThis.__exclUiHarness;
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
    export const FilterX = "F", Pencil = "P", Trash2 = "T", Check = "C", X = "X",
      Unused = "u";
  `,
};
const { outputFiles } = await build({
  entryPoints: [new URL("../views/admin/CrawlExclusionsView.tsx", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", jsx: "automatic", write: false,
  define: {
    setTimeout: "globalThis.__exclUiHarness.setTimeout",
    clearTimeout: "globalThis.__exclUiHarness.clearTimeout",
  },
  plugins: [{
    name: "excl-mocks",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: "excl-ui-mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "excl-ui-mock" }, args => ({
        contents: mocks[args.path], loader: "js",
      }));
    },
  }],
});
const { CrawlExclusionsView } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}
const find = (root, id) => elements(root, node => node.props?.["data-testid"] === id)[0];
const rule = { id: 5, pattern: "cart*", is_active: true, count_in_report: true, note: "Warenkorb", created_at: "2026-10-14T06:30:00Z", updated_at: "2026-10-14T06:30:00Z" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function harness(role = "admin", granted = true) {
  const h = {
    cursor: 0, slots: [], dependencies: [], effects: [], cleanups: [], timers: new Map(),
    timerId: 0, calls: [], rows: [{ ...rule }],
    auth: { isLoading: false, isAuthenticated: true, user: { id: 3, role },
      permissions: granted ? { crawl_ausschluesse: ["user_extended"] } : {} },
    setTimeout(fn) { const id = ++h.timerId; h.timers.set(id, fn); return id; },
    clearTimeout(id) { h.timers.delete(id); },
    async api(url, options) {
      if (options?.method === "DELETE") { h.rows = []; return json({ ok: true }); }
      if (url.endsWith("/test")) return json({ excluded: true, countedInReport: false, matches: [{ id: 5, pattern: "cart*", is_active: false, count_in_report: true }] });
      if (options?.method === "POST") return json({ error: "Muster existiert bereits" }, 409);
      if (options?.method === "PATCH") { h.rows = [{ ...h.rows[0], ...JSON.parse(options.body) }]; return json(h.rows[0]); }
      return json(h.rows);
    },
  };
  globalThis.__exclUiHarness = h;
  h.render = () => { h.cursor = 0; h.root = CrawlExclusionsView(); h.effects.splice(0).forEach(e => e()); return h.root; };
  h.settle = async () => { for (let i = 0; i < 5; i++) { h.render(); await new Promise(r => setImmediate(r)); } return h.root; };
  return h;
}

test("renders help text, count and rows; checkboxes default on", async () => {
  const h = harness();
  await h.settle();
  assert.ok(find(h.root, "exclusions-help"));
  assert.ok(find(h.root, "row-rule-5"));
  assert.ok(find(h.root, "exclusions-count"));
  assert.equal(find(h.root, "checkbox-new-active").props.checked, true);
  assert.equal(find(h.root, "checkbox-new-counted").props.checked, true);
  assert.equal(h.calls[0][0], "/api/admin/crawl-exclusions");
});

test("inline edit, toggle, delete confirmation naming the pattern", async () => {
  const h = harness();
  await h.settle();
  find(h.root, "button-edit-5").props.onClick();
  await h.settle();
  find(h.root, "input-pattern-5").props.onChange({ target: { value: "cart" } });
  await h.settle();
  await find(h.root, "button-save-5").props.onClick();
  await h.settle();
  const p = h.calls.find(([, o]) => o?.method === "PATCH");
  assert.equal(p[0], "/api/admin/crawl-exclusions/5");
  assert.equal(JSON.parse(p[1].body).pattern, "cart");
  await find(h.root, "toggle-active-5").props.onChange({ target: { checked: false } });
  await h.settle();
  assert.equal(JSON.parse(h.calls.filter(([, o]) => o?.method === "PATCH").at(-1)[1].body).is_active, false);
  find(h.root, "button-delete-5").props.onClick();
  await h.settle();
  assert.ok(find(h.root, "delete-confirm-text"));
  await find(h.root, "button-delete-confirm").props.onClick();
  await h.settle();
  assert.ok(find(h.root, "exclusions-empty"));
});

test("server error on create is shown and test result lists inactive match", async () => {
  const h = harness();
  await h.settle();
  find(h.root, "input-new-pattern").props.onChange({ target: { value: "cart*" } });
  await h.settle();
  await find(h.root, "form-add").props.onSubmit({ preventDefault() {} });
  await h.settle();
  assert.equal(find(h.root, "add-error").props.children, "Muster existiert bereits");
  find(h.root, "input-test-url").props.onChange({ target: { value: "https://x.test/cartridge" } });
  await h.settle();
  await find(h.root, "form-test").props.onSubmit({ preventDefault() {} });
  await h.settle();
  assert.ok(find(h.root, "test-result"));
  assert.ok(find(h.root, "test-match-5"));
});

test("access denied without feature", async () => {
  const h = harness("user", false);
  await h.settle();
  assert.equal(h.calls.length, 0);
  assert.ok(find(h.root, "exclusions-no-access"));
});

test("nav entry, view mapping and label count", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = f => readFile(new URL(f, import.meta.url), "utf8");
  assert.match(await read("../config/adminFeatures.ts"), /"score_einstellungen", "crawl_ausschluesse", "systemprotokoll"/);
  assert.match(await read("../components/layout/Sidebar.tsx"), /crawl_ausschluesse: 24/);
  assert.match(await read("../pages/Home.tsx"), /activeView === 24\s+&& <CrawlExclusionsView \/>/);
  assert.match(await read("./labelDefaults.ts"), /"nav.admin_crawl_ausschluesse"/);
});
