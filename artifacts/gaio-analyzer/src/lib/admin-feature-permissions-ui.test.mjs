import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const resultsSource = await readFile(new URL("../views/ErgebnisseView.tsx", import.meta.url), "utf8");
const authSource = await readFile(new URL("../store/authStore.tsx", import.meta.url), "utf8");
const accessFunction = authSource.match(/export function canAccess\([\s\S]*?\n\}/)[0];
const shareCondition = resultsSource.match(/const canShare = [^\n]+;/)[0];
const shareButton = resultsSource.match(/\{canShare && \(([\s\S]*?<\/Button>)\s*\)\}/)[1];
const mocks = {
  react: `
    export const Fragment = "fragment";
    export function useState(initial) {
      const h = globalThis.__adminUiHarness, i = h.cursor++;
      if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
      return [h.slots[i], value => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }];
    }
    export function useEffect(fn, deps) {
      const h = globalThis.__adminUiHarness, i = h.cursor++;
      const before = h.deps[i];
      if (!before || deps.some((value, j) => !Object.is(value, before[j]))) {
        h.deps[i] = deps;
        h.effects.push(fn);
      }
    }
  `,
  "react/jsx-runtime": `
    export const Fragment = "fragment";
    export function jsx(type, props, key) { return { type, props: props ?? {}, key }; }
    export const jsxs = jsx;
  `,
  "@/store/authStore": `
    ${accessFunction}
    export function useAuth() { return { ...globalThis.__adminUiHarness.auth, reloadPermissions: async () => {} }; }
    export async function adminFetch(url) {
      const h = globalThis.__adminUiHarness;
      h.calls.push(url);
      if (url.endsWith("/permissions")) return new Response(JSON.stringify(h.permissions));
      if (url.endsWith("/database")) return new Response(JSON.stringify({ source: "env", maskedUrl: "configured", connected: true }));
      return new Response("{}");
    }
  `,
  "@/lib/LabelProvider": `export function useT() { return key => key; }`,
  "lucide-react": `
    export const ShieldCheck = "icon", Save = "icon", CheckCircle = "icon", AlertCircle = "icon",
      Lock = "icon", Send = "icon", Loader2 = "icon", Eye = "icon", EyeOff = "icon",
      Database = "icon", Info = "icon", Share2 = "icon";
  `,
};
const plugin = {
  name: "admin-feature-ui-mocks",
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
      ? { path: args.path, namespace: "admin-ui-mock" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "admin-ui-mock" }, args => ({
      contents: mocks[args.path], loader: "ts",
    }));
  },
};
async function load(entry) {
  const { outputFiles } = await build({
    ...entry, bundle: true, platform: "node", format: "esm", jsx: "automatic",
    write: false, plugins: [plugin],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}
const { PermissionsView } = await load({ entryPoints: [new URL("../views/admin/PermissionsView.tsx", import.meta.url).pathname] });
const { MailserverView } = await load({ entryPoints: [new URL("../views/admin/MailserverView.tsx", import.meta.url).pathname] });
// Render the actual result view's share JSX and permission expression without
// importing unrelated result charts, API subscriptions or export engines.
const { ShareControl } = await load({ stdin: {
  contents: `import { useAuth, canAccess } from "@/store/authStore";
    import { useT } from "@/lib/LabelProvider";
    import { Share2 } from "lucide-react";
    const Button = "button";
    const setShareModal = () => {}, setShareResult = () => {}, setShareCopied = () => {};
    export function ShareControl() {
      const { isAuthenticated, user, permissions } = useAuth();
      const t = useT(); ${shareCondition}
      return <>{canShare && (${shareButton})}</>;
    }`,
  loader: "tsx",
} });
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
function harness(component, role = "admin", permissions = {}) {
  const h = {
    cursor: 0, slots: [], deps: [], effects: [], calls: [], permissions,
    auth: { user: role ? { id: 1, role } : null, isAuthenticated: !!role, permissions },
  };
  globalThis.__adminUiHarness = h;
  h.render = () => {
    h.cursor = 0; h.root = component();
    h.effects.splice(0).forEach(effect => effect());
  };
  h.settle = async () => {
    for (let i = 0; i < 5; i++) { h.render(); await new Promise(resolve => setImmediate(resolve)); }
  };
  return h;
}

test("fixed admin-only features render disabled and unchecked controls even with stale role grants", async () => {
  const h = harness(PermissionsView, "admin", {
    nutzerverwaltung: ["admin", "user_extended", "user"],
    rechtemanagement: ["admin", "user_extended", "user"],
    mailserver: ["admin", "user_extended"],
  });
  await h.settle();
  for (const feature of ["nutzerverwaltung", "rechtemanagement"]) {
    const row = elements(h.root, node => node.type === "tr" && hasText(node, `nav.admin_${feature}`))[0];
    assert.ok(row);
    const switches = elements(row, node => node.props?.role === "switch");
    assert.equal(switches.length, 2);
    assert.ok(switches.every(node => node.props.disabled && node.props["aria-checked"] === false));
    assert.ok(hasText(row, "perm.admin_only_hint"));
    switches[0].props.onClick();
    assert.deepEqual(h.slots[0][feature], ["admin", "user_extended", "user"]);
  }
  const mailRow = elements(h.root, node => node.type === "tr" && hasText(node, "nav.server"))[0];
  assert.ok(elements(mailRow, node => node.props?.role === "switch").every(node => !node.props.disabled));
});

test("server view hides the database section and makes no database request for non-admin roles", async () => {
  for (const role of ["user_extended", "user", null]) {
    const h = harness(MailserverView, role);
    await h.settle();
    assert.ok(!hasText(h.root, "mail.db_title"));
    assert.deepEqual(h.calls, ["/api/admin/settings/mail"]);
  }
  const h = harness(MailserverView, "admin");
  await h.settle();
  assert.ok(hasText(h.root, "mail.db_title"));
  assert.ok(h.calls.includes("/api/admin/settings/database"));
});

test("result share control is hidden without feature permission and shown for explicitly allowed roles", () => {
  for (const [role, permissions, expected] of [
    [null, {}, false], ["user", {}, false], ["user_extended", {}, false],
    ["user", { geteilte_analysen: ["user"] }, true],
    ["user_extended", { geteilte_analysen: ["user_extended"] }, true],
    ["admin", {}, true],
  ]) {
    const h = harness(ShareControl, role, permissions);
    h.render();
    assert.equal(elements(h.root, node => node.props?.["data-testid"] === "button-share").length > 0, expected);
  }
  assert.match(resultsSource, /\{canShare && shareModal && \(/);
});

test("admin-only hint has the requested German default and total label count is updated", async () => {
  const { labelDefaults } = await load({ entryPoints: [new URL("./labelDefaults.ts", import.meta.url).pathname] });
  assert.deepEqual(labelDefaults["perm.admin_only_hint"], { group: "admin", de: "Nur für Administratoren" });
  assert.equal(Object.keys(labelDefaults).length, 1323);
});
