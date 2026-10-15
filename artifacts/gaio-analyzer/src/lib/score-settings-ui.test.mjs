import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Window } from "happy-dom";
import React, { act } from "react";

const window = new Window({ url: "https://example.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node",
  "Event", "KeyboardEvent", "MouseEvent", "CustomEvent", "MutationObserver", "DocumentFragment", "localStorage"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? window : window[key] });
}
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const mocks = {
  "@/store/authStore": `export const useAuth = () => ({user: globalThis.__scoreViewer});
    export const adminFetch = (...args) => globalThis.__scoreFetch(...args);`,
  "@/lib/LabelProvider": "export const useT = () => globalThis.__scoreT;",
};
const { outputFiles } = await build({
  entryPoints: [new URL("../views/admin/ScoreSettingsView.tsx", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false, jsx: "automatic",
  plugins: [{ name: "score-ui-test", setup(b) {
    b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path)
      ? { path: args.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path] }));
    b.onResolve({ filter: /^[^./]/ }, args => args.path.startsWith("@/") ? undefined
      : { path: import.meta.resolve(args.path), external: true });
  }}],
});
const { ScoreSettingsView } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const labelBuild = await build({ entryPoints: [new URL("./labelDefaults.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false });
const { labelDefaults } = await import(`data:text/javascript;base64,${Buffer.from(labelBuild.outputFiles[0].contents).toString("base64")}`);
globalThis.__scoreT = (key, vars = {}) => Object.entries(vars).reduce(
  (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), labelDefaults[key]?.de ?? key);
const profiles = [
  { slug: "technical", label: "score.profile_technical", description: "score.profile_technical_desc", params: [
    { key: "weight_https", label: "HTTPS", help: "Help", current: 10, default: 10, min: 0, max: 30, step: 1 },
    { key: "weight_crawl", label: "Crawl", help: "Help", current: 12, default: 10, min: 0, max: 30, step: 1 },
  ] },
  { slug: "content", label: "Content", description: "Content description", params: [
    { key: "weight", label: "Weight", help: "Help", current: 20, default: 20, min: 0, max: 30, step: 1 },
  ] },
];
const clone = x => structuredClone(x);
let root, host;
async function mount({ storageThrows = false, fetcher, clear = true, viewer = 1 } = {}) {
  if (root) await act(async () => root.unmount());
  Object.defineProperty(globalThis, "localStorage", { configurable: true,
    get: storageThrows ? () => { throw new Error("blocked"); } : () => window.localStorage });
  if (clear) window.localStorage.clear();
  globalThis.__scoreViewer = { id: viewer, role: "admin" };
  globalThis.__scoreFetch = fetcher ?? (async () => ({ ok: true, json: async () => clone(profiles) }));
  host?.remove();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(React.createElement(ScoreSettingsView)); });
}
const triggers = () => [...host.querySelectorAll("button[aria-expanded]")];
const click = async button => { await act(async () => button.click()); };
const resetButton = () => [...host.querySelectorAll("button")].find(b => b.textContent.includes("zurücksetzen"));
after(async () => { if (root) await act(async () => root.unmount()); await window.happyDOM.close(); });

test("Radix starts collapsed, shows counts/customization, and opens multiple profiles with accessible buttons", async () => {
  await mount();
  assert.equal(triggers().length, 2);
  for (const trigger of triggers()) {
    assert.equal(trigger.tagName, "BUTTON");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(trigger.querySelector("button"), null);
  }
  assert.match(triggers()[0].textContent, /2 Einstellungen/);
  assert.match(triggers()[0].textContent, /Angepasst/);
  assert.match(triggers()[1].textContent, /1 Einstellungen/);
  assert.doesNotMatch(triggers()[1].textContent, /Angepasst/);
  assert.equal(host.querySelectorAll('input[type="range"]').length, 0);
  await click(triggers()[0]);
  assert.equal(triggers()[0].getAttribute("aria-expanded"), "true");
  assert.equal(host.querySelectorAll('input[type="range"]').length, 2);
  assert.match(host.textContent, /So entsteht der Technik-Score/);
  assert.ok(resetButton().closest('[role="region"]'));
  await click(triggers()[1]);
  assert.ok(triggers().every(t => t.getAttribute("aria-expanded") === "true"));
  await act(async () => triggers()[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  assert.equal(document.activeElement, triggers()[1]);
});
test("reset stays inside content, calls the unchanged API, clears customization and shows success", async () => {
  const calls = [];
  await mount({ fetcher: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => init?.method === "POST"
      ? { ...clone(profiles[0]), params: profiles[0].params.map(p => ({ ...p, current: p.default })) } : clone(profiles) };
  } });
  await click(triggers()[0]); await click(resetButton());
  assert.equal(calls.at(-1).url, "/api/admin/score-profiles/technical/reset");
  assert.equal(calls.at(-1).init.method, "POST");
  assert.doesNotMatch(triggers()[0].textContent, /Angepasst/);
  assert.match(host.querySelector('[role="status"]').textContent, /Gespeichert/);
});
test("open items persist per viewer, restore on reload, and never leak into another viewer", async () => {
  await mount(); await click(triggers()[0]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("gaio.scoreSettings.open"))["1"], ["technical"]);
  await mount({ clear: false });
  assert.equal(triggers()[0].getAttribute("aria-expanded"), "true");
  await mount({ clear: false, viewer: 2 });
  assert.ok(triggers().every(t => t.getAttribute("aria-expanded") === "false"));
  await click(triggers()[1]);
  assert.deepEqual(JSON.parse(window.localStorage.getItem("gaio.scoreSettings.open")), { "1": ["technical"], "2": ["content"] });
});
test("accordion works when localStorage access throws", async () => {
  await mount({ storageThrows: true });
  assert.ok(triggers().every(t => t.getAttribute("aria-expanded") === "false"));
  await click(triggers()[0]); assert.equal(triggers()[0].getAttribute("aria-expanded"), "true");
  await click(triggers()[0]); assert.equal(triggers()[0].getAttribute("aria-expanded"), "false");
});
test("failed debounced save reopens a collapsed profile and exposes its error", async () => {
  let finish;
  const calls = [];
  await mount({ fetcher: async (url, init) => {
    calls.push({ url, init });
    return init?.method === "PATCH" ? new Promise(resolve => { finish = resolve; })
      : { ok: true, json: async () => clone(profiles) };
  } });
  await click(triggers()[0]);
  const slider = host.querySelector('input[type="range"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(slider, "15");
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
    slider.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await click(triggers()[0]);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  assert.equal(calls.at(-1).init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { key: "weight_https", value: 15 });
  assert.equal(triggers()[0].getAttribute("aria-expanded"), "false");
  await act(async () => finish({ ok: false }));
  assert.equal(triggers()[0].getAttribute("aria-expanded"), "true");
  assert.match(host.querySelector('[role="status"]').textContent, /Fehler/);
});
test("slider changes retain debounced saving and success messages survive collapse/reopen", async () => {
  const calls = [];
  await mount({ fetcher: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => init?.method === "PATCH"
      ? { ...clone(profiles[1]), params: [{ ...profiles[1].params[0], current: JSON.parse(init.body).value }] }
      : clone(profiles) };
  } });
  await click(triggers()[1]);
  const slider = host.querySelector('input[type="range"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(slider, "25");
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  assert.match(triggers()[1].textContent, /Angepasst/);
  assert.equal(calls.length, 1, "save remains debounced");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  assert.equal(calls.at(-1).url, "/api/admin/score-profiles/content");
  assert.equal(calls.at(-1).init.method, "PATCH");
  assert.match(host.querySelector('[role="status"]').textContent, /Gespeichert/);
  await click(triggers()[1]); await click(triggers()[1]);
  assert.match(host.querySelector('[role="status"]').textContent, /Gespeichert/);
});
test("technical default matches the supplied German description exactly, including line breaks", async () => {
  const expected = (await readFile(new URL("./fixtures/score-technical-description.txt", import.meta.url), "utf8")).trimEnd();
  assert.equal(labelDefaults["score.profile_technical_desc"].de, expected);
  assert.equal(Object.keys(labelDefaults).length, 1323);
});
test("retry credit has the requested German slider, saves its numeric value, and resets to 50 percent", async () => {
  const param = { key: "retry_credit", label: "score.param_retry_credit_label", help: "score.param_retry_credit_help",
    current: 0.5, default: 0.5, min: 0, max: 1, step: 0.05 };
  const profile = { ...clone(profiles[0]), params: [param] };
  const calls = [];
  await mount({ fetcher: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => !init?.method ? [clone(profile)]
      : { ...clone(profile), params: [{ ...param, current: init.method === "POST" ? 0.5 : JSON.parse(init.body).value }] } };
  } });
  await click(triggers()[0]);
  let slider = host.querySelector('input[type="range"]');
  assert.deepEqual([slider.min, slider.max, slider.step, slider.value], ["0", "1", "0.05", "0.5"]);
  assert.match(host.textContent, /Anteil, den ein erst nach Wiederholung erfolgreicher Abruf zählt/);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(slider, "0.75");
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
    slider.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  assert.equal(calls.at(-1).init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { key: "retry_credit", value: 0.75 });
  assert.match(triggers()[0].textContent, /Angepasst/);
  await click(resetButton());
  slider = host.querySelector('input[type="range"]');
  assert.equal(slider.value, "0.5");
  assert.doesNotMatch(triggers()[0].textContent, /Angepasst/);
});
test("retry-credit label, help and extended profile description render through t rather than fixed German", async () => {
  const previous = globalThis.__scoreT;
  const translated = {
    "score.profile_technical_desc": "Translated technical description, including retry-credit sentence",
    "score.param_retry_credit_label": "Translated retry credit",
    "score.param_retry_credit_help": "Translated retry help",
  };
  globalThis.__scoreT = (key, vars) => translated[key] ?? previous(key, vars);
  try {
    await mount({ fetcher: async () => ({ ok: true, json: async () => [{
      ...clone(profiles[0]), params: [{ key: "retry_credit", label: "score.param_retry_credit_label",
        help: "score.param_retry_credit_help", current: 0.5, default: 0.5, min: 0, max: 1, step: 0.05 }],
    }] }) });
    await click(triggers()[0]);
    for (const text of Object.values(translated)) assert.ok(host.textContent.includes(text));
    assert.ok(!host.textContent.includes("Abrufe, die erst nach einer Wiederholung gelingen"));
  } finally { globalThis.__scoreT = previous; }
});
