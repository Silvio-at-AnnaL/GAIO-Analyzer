import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { Window } = await import(require.resolve("happy-dom"));
const window = new Window({ url: "https://gaio.test/" });
for (const key of ["window", "document", "HTMLElement", "Node", "Event", "MouseEvent", "navigator"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
after(() => window.happyDOM.abort());

const auth = await readFile(new URL("../store/authStore.tsx", import.meta.url), "utf8");
const access = auth.match(/export function canAccess\([\s\S]*?\n\}/)[0];
const icons = ["Download", "Coins", "ShieldCheck", "Save", "CheckCircle", "AlertCircle", "Lock",
  "Globe", "FileCode", "BarChart3", "HelpCircle", "Mail", "Settings", "Menu", "LogIn", "User", "Users", "Server",
  "ArrowLeftRight", "BrainCircuit", "BarChart2", "Palette", "SlidersHorizontal", "ChevronDown", "ScrollText",
  "AlertTriangle", "Inbox", "FilterX"];
const mocks = {
  "@/store/authStore": `${access}
    export const useAuth=()=>({...globalThis.__kostenUi.auth,reloadPermissions:async()=>{}});
    export async function adminFetch(url,options){
      const h=globalThis.__kostenUi;h.requests.push({url,options});
      if(url.includes("/usage/"))return h.fetch(url,options);
      if(url.endsWith("/permissions"))return new Response(JSON.stringify(h.auth.permissions));
      return new Response("{}");
    }`,
  "@/store/appStore": `export const useAppStore=()=>({activeView:25,setActiveView(){},
    analysisStatus:"idle",setSystemLogAnalysisId(){}});`,
  "@/store/brandingStore": `export const useBranding=()=>({});`,
  "@/lib/LabelProvider": `export const useT=()=>globalThis.__kostenUi.t;
    export const useLabelContext=()=>({locale:"de",setLocale(){},locales:[{code:"de"}]});`,
  "lucide-react": icons.map(name => `export const ${name}=()=>null;`).join("\n"),
  recharts: `import {createElement as el} from "react";
    export const ResponsiveContainer=({children})=>el("div",null,children);
    export const BarChart=({data,children})=>el("div",{"data-testid":"chart-points","data-points":JSON.stringify(data)},children);
    export const Tooltip=()=>null;
    export const Bar=()=>null;export const XAxis=()=>null;export const YAxis=()=>null;export const CartesianGrid=()=>null;`,
};
async function load(path) {
  const { outputFiles } = await build({
    entryPoints: [new URL(path, import.meta.url).pathname],
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false,
    external: ["react", "react/jsx-runtime"], define: { "import.meta.env.BASE_URL": '"/"' },
    plugins: [{ name: "kosten-ui", setup(b) {
      b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "ts" }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}
const helpers = await load("./usage-helpers.ts");
const { labelDefaults } = await load("./labelDefaults.ts");
const { UsageView } = await load("../views/admin/UsageView.tsx");
const { Sidebar } = await load("../components/layout/Sidebar.tsx");
const { PermissionsView } = await load("../views/admin/PermissionsView.tsx");
const { ADMIN_FEATURES, ADMIN_NAV_GROUPS } = await load("../config/adminFeatures.ts");
const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) =>
  text.replaceAll(`{${name}}`, String(value)), labelDefaults[key]?.de ?? key);
const row = (extra = {}) => ({
  calls: 3, llmCalls: 2, searchCalls: 1, inputTokens: 1234, outputTokens: 567,
  searchCredits: 3, costUsd: 1.5, ...extra,
});
const sample = () => ({
  totals: { inputTokens: 1234, outputTokens: 567, costUsd: 1.5, searchCredits: 3, searchCostUsd: null },
  analysesCount: 2, avgCostPerAnalysis: 0.75,
  byArea: [row({ area: "analysis" }), row({ area: "preparation", costUsd: null })],
  byModule: [row({ module: "content-relevance" }), row({ module: "new-module", costUsd: null })],
  byModel: [row({ model: null, costUsd: null }), row({ model: "claude" })],
  byDay: [{ day: "2026-10-16", costUsd: 1.5, inputTokens: 1234, outputTokens: 567, searchCredits: 3, analyses: 2 }],
  searchMonth: { used: 3, included: 1000, plan: "free" },
});
let mounted;
async function mount(Component = UsageView, { role = "admin", permissions = {}, data = sample(), fetch } = {}) {
  if (mounted) await mounted.close();
  const host = document.createElement("div"); document.body.append(host);
  const h = globalThis.__kostenUi = {
    t, requests: [], data, auth: { user: role ? { id: 1, role, username: "tester" } : null,
      isAuthenticated: !!role, isLoading: false, permissions },
    fetch: fetch ?? (async url => new Response(url.includes("export.csv") ? "id;cost\r\n1;1.5\r\n" : JSON.stringify(h.data))),
  };
  h.host = host; h.root = createRoot(host);
  h.update = async () => act(async () => { h.root.render(React.createElement(Component)); });
  h.change = async (selector, value) => act(async () => {
    const el = host.querySelector(selector); assert.ok(el, selector); el.value = value;
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  h.close = async () => { await act(async () => h.root.unmount()); host.remove(); mounted = null; };
  mounted = h; await h.update(); return h;
}
after(async () => { if (mounted) await mounted.close(); });

test("presets produce inclusive Berlin plain dates, including month and year boundaries", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  for (const [preset, from, to] of [
    ["today", "2026-10-16", "2026-10-16"], ["last7", "2026-10-10", "2026-10-16"],
    ["last30", "2026-09-17", "2026-10-16"], ["month", "2026-10-01", "2026-10-16"],
    ["prevMonth", "2026-09-01", "2026-09-30"],
  ]) assert.deepEqual(helpers.presetRange(preset, now), { from, to });
  assert.deepEqual(helpers.presetRange("prevMonth", new Date("2027-01-05T10:00:00Z")), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(helpers.presetRange("prevMonth", new Date("2024-03-01T10:00:00Z")), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(helpers.presetRange("month", new Date("2026-09-30T22:30:00Z")), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(helpers.presetRange("last7", new Date("2027-01-01T10:00:00Z")), { from: "2026-12-26", to: "2027-01-01" });
  assert.deepEqual(helpers.presetRange("month", new Date("2026-10-31T22:30:00Z")), { from: "2026-10-01", to: "2026-10-31" });
});

test("chart fills all missing days, retains data and spans DST and long custom periods", () => {
  const day = { day: "2026-10-25", costUsd: 0.5, inputTokens: 10, outputTokens: 2, searchCredits: 3, analyses: 1 };
  const filled = helpers.chartData([day], "2026-10-24", "2026-10-26");
  assert.deepEqual(filled.map(x => [x.day, x.cost]), [["2026-10-24", 0], ["2026-10-25", 0.5], ["2026-10-26", 0]]);
  assert.equal(filled[0].analyses, 0);
  assert.equal(filled[1].inputTokens, 10);
  assert.equal(helpers.chartData([], "2024-01-01", "2025-12-31").length, 731);
  assert.equal(helpers.chartData([], "2024-02-28", "2024-03-01").length, 3);
});

test("all known area and module labels are German and unknown IDs remain raw", () => {
  for (const id of helpers.AREA_IDS) assert.notEqual(helpers.areaLabel(id, t), id);
  for (const id of helpers.MODULE_IDS) assert.notEqual(helpers.moduleLabel(id, t), id);
  assert.equal(helpers.areaLabel("new-area", t), "new-area");
  assert.equal(helpers.moduleLabel("new-module", t), "new-module");
  assert.equal(helpers.moduleLabel("preflight", t), "KI-Verbindungsprüfung");
  assert.equal(helpers.modelLabel(null, t), "Websuche (Tavily)");
  assert.equal(helpers.modelLabel("claude", t), "claude");
});

test("cost ordering is descending, stable for ties, nulls last, without mutating input", () => {
  const rows = [{ costUsd: null, id: "null" }, { costUsd: 0, id: "zero" },
    { costUsd: 2, id: "a" }, { costUsd: 2, id: "b" }, { costUsd: 1, id: "one" }];
  assert.deepEqual(helpers.sortByCost(rows).map(x => x.id), ["a", "b", "one", "zero", "null"]);
  assert.equal(rows[0].id, "null");
});

test("default period is last30/live and each environment is sent in real view requests", async () => {
  const h = await mount();
  assert.equal(h.host.querySelector('[data-testid="select-period"]').value, "last30");
  for (const env of ["live", "dev", "all"]) {
    if (env !== "live") await h.change('[data-testid="select-env"]', env);
    const url = new URL(h.requests.filter(x => x.url.includes("summary")).at(-1).url, "https://test/");
    assert.equal(url.searchParams.get("env"), env);
    assert.match(url.searchParams.get("from"), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(url.searchParams.get("to"), /^\d{4}-\d{2}-\d{2}$/);
  }
  await h.change('[data-testid="select-period"]', "custom");
  assert.equal(h.host.querySelectorAll('input[type="date"]').length, 2);
  const points = JSON.parse(h.host.querySelector('[data-testid="chart-points"]').dataset.points);
  assert.equal(points.length, 30);
});

test("tiles and all three tables render formatted values, labels and cost-descending rows", async () => {
  const h = await mount();
  assert.match(h.host.querySelector('[data-testid="tile-cost"]').textContent, /1,50/);
  assert.match(h.host.querySelector('[data-testid="tile-analyses"]').textContent, /0,75/);
  assert.match(h.host.querySelector('[data-testid="tile-tokens-in"]').textContent, /1\.234/);
  assert.equal(h.host.querySelectorAll('[data-testid="tile-search"] p').length, 2);
  assert.match(h.host.querySelector('[data-testid="row-area-analysis"]').textContent, /Analysen/);
  assert.match(h.host.querySelector('[data-testid="row-module-content-relevance"]').textContent, /Inhaltsrelevanz/);
  const models = [...h.host.querySelectorAll('[data-testid="table-model"] tbody tr')];
  assert.equal(models[0].querySelector("td").textContent, "claude");
  assert.equal(models[1].querySelector("td").textContent, "Websuche (Tavily)");
  assert.equal(models[1].lastElementChild.textContent, "–");
});

test("Tavily uses existing thresholds and quota warning in the new view", async () => {
  for (const [used, level] of [[790, "normal"], [800, "amber"], [1000, "red"]]) {
    const data = sample(); data.searchMonth.used = used;
    const h = await mount(UsageView, { data });
    const line = h.host.querySelector('[data-testid="text-tavily-usage"]');
    assert.equal(line.dataset.level, level);
    assert.match(line.textContent, /\(free\)/);
    assert.equal(line.textContent.includes(t("ai.search_quota_exhausted")), level === "red");
  }
});

test("empty, loading, HTTP-error and network-error states render without exposing stale results", async () => {
  const data = sample();
  Object.assign(data, { totals: { inputTokens: 0, outputTokens: 0, costUsd: null, searchCredits: 0, searchCostUsd: null },
    byArea: [], byModule: [], byModel: [], byDay: [], analysesCount: 0, avgCostPerAnalysis: null });
  let h = await mount(UsageView, { data });
  assert.equal(h.host.querySelector('[data-testid="usage-empty"]').textContent, t("usage.empty"));
  h = await mount(UsageView, { fetch: () => new Promise(() => {}) });
  assert.ok(h.host.querySelector('[data-testid="usage-loading"]'));
  h = await mount(UsageView, { fetch: async () => new Response("{}", { status: 500 }) });
  assert.match(h.host.querySelector('[data-testid="usage-error"]').textContent, new RegExp(t("usage.load_error")));
  assert.equal(h.host.querySelector('[data-testid="tile-cost"]'), null);
  h = await mount(UsageView, { fetch: async () => { throw new Error("offline"); } });
  assert.match(h.host.querySelector('[data-testid="usage-error"]').textContent, new RegExp(t("usage.network_error")));
});

test("view denies ungranted roles and never requests costs; admin and delegated users pass", async () => {
  for (const role of [null, "user", "user_extended"]) {
    const h = await mount(UsageView, { role });
    assert.ok(h.host.querySelector('[data-testid="usage-no-access"]'));
    assert.equal(h.requests.length, 0);
    assert.equal(h.host.querySelector('[data-testid="tile-cost"]'), null);
  }
  for (const [role, permissions] of [["admin", {}], ["user", { kosten: ["user"] }]]) {
    const h = await mount(UsageView, { role, permissions });
    assert.ok(h.host.querySelector('[data-testid="tile-cost"]'));
  }
});

test("sidebar follows kosten permissions and the matrix lists its admin-default feature", async () => {
  for (const [role, permissions, visible] of [
    ["admin", {}, true], ["user", {}, false], ["user_extended", {}, false], ["user", { kosten: ["user"] }, true],
  ]) {
    const h = await mount(Sidebar, { role, permissions });
    assert.equal(!!h.host.querySelector('[data-testid="nav-item-25"]'), visible);
  }
  const h = await mount(PermissionsView);
  assert.ok([...h.host.querySelectorAll("tr")].some(tr => tr.textContent.includes("Kosten")));
  assert.deepEqual(ADMIN_FEATURES.find(x => x.id === "kosten").defaultRoles, ["admin"]);
  assert.ok(ADMIN_NAV_GROUPS.find(x => x.id === "system").items.includes("kosten"));
});

test("CSV uses selected filters, requested filename and the system-log blob download technique", async () => {
  const h = await mount();
  await h.change('[data-testid="select-env"]', "all");
  const created = [], revoked = [], downloads = [];
  const beforeCreate = URL.createObjectURL, beforeRevoke = URL.revokeObjectURL;
  const beforeClick = window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => { created.push(blob); return "blob:kosten-test"; };
  URL.revokeObjectURL = value => revoked.push(value);
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ filename: this.download, attached: document.body.contains(this) });
  };
  try {
    await act(async () => h.host.querySelector('[data-testid="button-export-csv"]').click());
    const request = h.requests.find(x => x.url.includes("export.csv"));
    const params = new URL(request.url, "https://test/").searchParams;
    assert.equal(params.get("env"), "all");
    assert.equal(downloads[0].filename, helpers.usageCsvFilename(params.get("from"), params.get("to"), "all"));
    assert.equal(downloads[0].attached, true);
    assert.equal(created.length, 1);
    assert.deepEqual(revoked, ["blob:kosten-test"]);
    assert.equal(document.querySelector('a[download^="kosten_"]'), null);
  } finally {
    URL.createObjectURL = beforeCreate; URL.revokeObjectURL = beforeRevoke;
    window.HTMLAnchorElement.prototype.click = beforeClick;
  }
});
