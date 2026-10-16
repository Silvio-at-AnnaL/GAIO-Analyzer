import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
import React, { act } from "react";

const window = new Window({ url: "https://example.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "localStorage"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

async function load(entry, mocks = {}) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", write: false, jsx: "automatic",
    plugins: [{ name: "preparation-ui", setup(b) {
      b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
        ? { path: args.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
      b.onResolve({ filter: /^[^./]/ }, args => args.path.startsWith("@/") ? undefined
        : { path: import.meta.resolve(args.path), external: true });
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}
const { preparationUrlKey, newDomainPreparation } = await load("./domain-preparation.ts");
const { AppProvider, useAppStore } = await load("../store/appStore.tsx");
const { AnalysisLogView } = await load("../views/admin/AnalysisLogView.tsx", {
  "@/store/appStore": "export const useAppStore = () => ({});",
  "@/store/authStore": `const auth = {
    user: { role: "admin" }, isAuthenticated: true, isLoading: false, permissions: {}
  }; export const useAuth = () => auth; export const canAccess = () => true;
  export const adminFetch = async () => ({ok:true,json:async()=>globalThis.__preparationLog});`,
  "@/lib/LabelProvider": `const t = key => key; export const useT = () => t;
    export const useLabelContext = () => ({locale:"de"});`,
});
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); });

test("preparation URL comparison normalizes host and trailing slash but distinguishes paths", () => {
  assert.equal(preparationUrlKey("https://WWW.Example.test/path/"), preparationUrlKey("http://example.test/path"));
  assert.notEqual(preparationUrlKey("https://example.test/a"), preparationUrlKey("https://example.test/b"));
});

test("UUID unavailability never blocks preparation", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
  try { assert.equal(newDomainPreparation("https://example.test"), null); }
  finally { Object.defineProperty(globalThis, "crypto", original); }
});

test("the real app store retains preparation across navigation and clears on URL change, reset or import", async () => {
  let store;
  function Probe() { store = useAppStore(); return null; }
  await act(async () => root.render(React.createElement(AppProvider, null, React.createElement(Probe))));
  const form = { companyName: "Example", url: "https://example.test", personas: "", competitors: [""] };
  const prep = newDomainPreparation(form.url);
  await act(async () => store.setDomainForm(form));
  await act(async () => store.setDomainPreparation(prep));
  await act(async () => store.setActiveView(3));
  await act(async () => store.setActiveView(1));
  assert.deepEqual(store.domainPreparation, prep);
  await act(async () => store.setDomainForm({ ...form, personas: "buyers" }));
  assert.deepEqual(store.domainPreparation, prep);
  await act(async () => store.setDomainForm({ ...form, url: "https://example.test/other" }));
  assert.equal(store.domainPreparation, null);
  await act(async () => store.setDomainPreparation(prep));
  await act(async () => store.setDomainForm({ companyName: "", url: "", personas: "", competitors: [""] }));
  assert.equal(store.domainPreparation, null);
  await act(async () => store.setDomainForm(form));
  await act(async () => store.setDomainPreparation(prep));
  await act(async () => store.setSetupImportNotice({ source: "block-v2", warnings: [], count: 1 }));
  assert.equal(store.domainPreparation, null);
});

test("admin analysis log renders provider and model under the domain, and no metadata for legacy entries", async () => {
  const item = { id: 1, domain: "https://example.test", startedAt: "2026-10-16T10:00:00Z",
    status: "completed", gaioScore: null, hasHtmlExport: false };
  globalThis.__preparationLog = { items: [
    { ...item, llmProvider: "claude", llmModel: "claude-sonnet-4-6" },
    { ...item, id: 2 },
  ], total: 2, pages: 1, page: 1, storageTotalKb: 0 };
  await act(async () => root.render(React.createElement(AnalysisLogView)));
  const rows = host.querySelectorAll("tbody tr");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].textContent.includes("claude · claude-sonnet-4-6"));
  assert.equal(rows[1].querySelector("td:nth-child(2) p"), null);
  assert.equal(host.querySelectorAll("th").length, 7);
});
