import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const reactMock = `
  export function useState(initial) {
    const harness = globalThis.__setupImportHarness;
    const index = harness.cursor++;
    if (!(index in harness.slots)) {
      harness.slots[index] = typeof initial === "function" ? initial() : initial;
    }
    return [harness.slots[index], value => {
      harness.slots[index] = typeof value === "function" ? value(harness.slots[index]) : value;
    }];
  }
  export function useRef(current) {
    const harness = globalThis.__setupImportHarness;
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = { current };
    return harness.slots[index];
  }
  export function useEffect(effect, dependencies) {
    const harness = globalThis.__setupImportHarness;
    const index = harness.cursor++;
    const previous = harness.dependencies[index];
    const changed = !dependencies || !previous || dependencies.length !== previous.length
      || dependencies.some((value, i) => !Object.is(value, previous[i]));
    if (changed) {
      harness.dependencies[index] = dependencies;
      harness.pending.push(effect);
    }
  }
`;

const jsxRuntimeMock = `
  export const Fragment = Symbol.for("react.fragment");
  export function jsx(type, props = {}, key) {
    const element = { type, props, key };
    if (props.ref && typeof props.ref === "object") props.ref.current = element;
    element.click = () => props.onClick?.({ currentTarget: element });
    element.focus = () => {};
    element.select = () => {};
    element.scrollIntoView = () => {};
    return element;
  }
  export const jsxs = jsx;
`;

const sharedMocks = {
  react: reactMock,
  "react/jsx-runtime": jsxRuntimeMock,
  "@/store/authStore": `
    export const useAuth = () => globalThis.__setupImportContext.auth;
    export const canAccess = (_feature, role, permissions) =>
      role === "admin" || Boolean(permissions?.setup_import);
  `,
  "@/store/appStore": `export const useAppStore = () => globalThis.__setupImportContext.store;`,
  "@/lib/LabelProvider": `export const useT = () => key => key;`,
};

const uiMocks = {
  "@/components/ui/button": `export const Button = "button";`,
  "@/components/ui/input": `export const Input = "input";`,
  "@/components/ui/textarea": `export const Textarea = "textarea";`,
  "@/components/ui/label": `export const Label = "label";`,
  "@/components/ui/InfoTooltip": `export const InfoTooltip = "span";`,
  "lucide-react": `
    export const Plus = "svg", X = "svg", Loader2 = "svg", ChevronDown = "svg";
    export const ChevronUp = "svg", Pencil = "svg", Check = "svg", Sparkles = "svg";
    export const Globe = "svg", CheckCircle2 = "svg", AlertTriangle = "svg";
  `,
  "@workspace/api-client-react": `
    export const useStartAnalysis = () => globalThis.__setupImportContext.startAnalysis;
    export const usePrefillQuestionnaire = () => globalThis.__setupImportContext.prefillMutation;
  `,
  "@/lib/utils": `
    export const competitorKey = value => typeof value === "string" ? value.trim().toLowerCase() : "";
    export const normalizeUrl = value => value;
  `,
};

async function bundleEntry(entry, { includeViewMocks = false } = {}) {
  const mocks = includeViewMocks ? { ...sharedMocks, ...uiMocks } : sharedMocks;
  const componentPath = new URL("../components/SetupImportLink.tsx", import.meta.url).pathname;
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    jsx: "automatic",
    define: { "import.meta.env.BASE_URL": '"/"' },
    plugins: [{
      name: "setup-import-ui-test-mocks",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (includeViewMocks && args.path === "@/components/SetupImportLink") {
            return { path: componentPath };
          }
          return Object.hasOwn(mocks, args.path)
            ? { path: args.path, namespace: "setup-import-ui-test-mock" }
            : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "setup-import-ui-test-mock" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}

const { SetupImportLink } = await bundleEntry("../components/SetupImportLink.tsx");
const { DomainAnalyseView } = await bundleEntry("../views/DomainAnalyseView.tsx", { includeViewMocks: true });

function makeHarness() {
  return {
    cursor: 0,
    slots: [],
    dependencies: [],
    pending: [],
    render(component, props = {}) {
      this.cursor = 0;
      this.pending = [];
      const tree = component(props);
      for (const effect of this.pending) effect();
      return tree;
    },
  };
}

function makeStore(overrides = {}) {
  const store = {
    domainForm: { companyName: "", url: "", personas: "", competitors: [""] },
    crawledPages: [],
    selectedPages: [],
    setupImportNotice: null,
    calls: [],
    timeline: [],
    ...overrides,
  };
  store.setDomainForm = (value) => {
    store.calls.push(["setDomainForm", value]);
    store.timeline.push("setDomainForm");
    store.domainForm = value;
  };
  store.setCrawledPages = (value) => {
    store.calls.push(["setCrawledPages", value]);
    store.timeline.push("setCrawledPages");
    store.crawledPages = value;
  };
  store.setSelectedPages = (value) => {
    store.calls.push(["setSelectedPages", value]);
    store.timeline.push("setSelectedPages");
    store.selectedPages = value;
  };
  store.setSetupImportNotice = (value) => {
    store.calls.push(["setSetupImportNotice", value]);
    store.timeline.push("setSetupImportNotice");
    store.setupImportNotice = value;
  };
  return store;
}

function makeContext(overrides = {}) {
  const store = overrides.store ?? makeStore();
  return {
    auth: { isAuthenticated: true, user: { role: "admin" }, permissions: {} },
    store,
    confirmAnswer: true,
    confirmCalls: 0,
    reads: 0,
    onImportedCalls: 0,
    startAnalysis: { mutateCalls: [], mutate(...args) { this.mutateCalls.push(args); } },
    prefillMutation: {
      isPending: false,
      isSuccess: false,
      data: undefined,
      resetCalls: 0,
      mutateCalls: [],
      reset() {
        this.resetCalls += 1;
        store.timeline.push("prefill-reset");
        this.isSuccess = false;
        this.data = undefined;
      },
      mutate(...args) { this.mutateCalls.push(args); },
    },
    ...overrides,
    store,
  };
}

function installHarness(harness, context) {
  globalThis.__setupImportHarness = harness;
  globalThis.__setupImportContext = context;
}

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return findElement(node.props?.children, predicate);
}

function byTestId(tree, testId) {
  return findElement(tree, (node) => node.props?.["data-testid"] === testId);
}

function textContent(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!node || typeof node !== "object") return "";
  return textContent(node.props?.children);
}

const setupBlock = (overrides = {}) => ({
  blockVersion: 2,
  status: "completed",
  mode: "url",
  url: "https://imported.example.test",
  companyName: "Imported Company",
  persona: "Imported buyers",
  competitors: ["https://rival-0.example.test", "https://rival-1.example.test"],
  pages: ["https://imported.example.test/z", "https://imported.example.test/a"],
  requestedPages: null,
  pageSelection: "auto",
  exportDate: "2026-10-01T10:00:00Z",
  analysisId: "synthetic-ui-import",
  ...overrides,
});

const reportHtml = (data = setupBlock()) =>
  `<script id="gaio-analysis-data" type="application/json">${JSON.stringify(data)}</script>`;

class SyntheticFileReader {
  readAsText(file) {
    globalThis.__setupImportContext.reads += 1;
    if (file.readFailureCount > 0) {
      file.readFailureCount -= 1;
      this.onerror?.(new Error("Synthetic FileReader failure"));
      return;
    }
    this.result = file.result ?? file.contents;
    this.onload?.({ target: { result: this.result } });
  }
}

async function withBrowserGlobals(run) {
  const previousReader = globalThis.FileReader;
  const previousWindow = globalThis.window;
  globalThis.FileReader = SyntheticFileReader;
  globalThis.window = {
    confirm() {
      const context = globalThis.__setupImportContext;
      context.confirmCalls += 1;
      return context.confirmAnswer;
    },
  };
  try {
    await run();
  } finally {
    if (previousReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = previousReader;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

async function flushImport() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function changeFile(tree, file) {
  const input = byTestId(tree, "input-setup-import");
  assert.ok(input, "the hidden file input should be rendered");
  const currentTarget = { files: [file], value: "selected-file" };
  input.props.onChange({ currentTarget });
  assert.equal(currentTarget.value, "", "the picker value is reset immediately");
  return input;
}

test("the real import link is hidden without access and visible to admins or explicitly permitted users", () => {
  const cases = [
    [{ isAuthenticated: false, user: null, permissions: {} }, false],
    [{ isAuthenticated: true, user: { role: "user" }, permissions: {} }, false],
    [{ isAuthenticated: true, user: { role: "admin" }, permissions: {} }, true],
    [{ isAuthenticated: true, user: { role: "user" }, permissions: { setup_import: true } }, true],
  ];
  for (const [auth, visible] of cases) {
    const context = makeContext({ auth });
    const harness = makeHarness();
    installHarness(harness, context);
    const tree = harness.render(SetupImportLink);
    assert.equal(Boolean(byTestId(tree, "button-setup-import")), visible);
    assert.equal(Boolean(byTestId(tree, "input-setup-import")), visible);
  }
});

test("a valid HTML or HTM import replaces the form and preserves report page order and notices", async () => {
  await withBrowserGlobals(async () => {
    const context = makeContext();
    const harness = makeHarness();
    installHarness(harness, context);
    const imported = setupBlock({
      competitors: Array.from({ length: 6 }, (_, index) => `https://rival-${index}.example.test`),
      pages: ["https://imported.example.test/third", "https://imported.example.test/first"],
      requestedPages: ["https://imported.example.test/not-analyzed"],
      persona: null,
    });
    let tree = harness.render(SetupImportLink, {
      onImported: () => { context.onImportedCalls += 1; },
    });
    assert.equal(byTestId(tree, "input-setup-import").props.accept, ".html,.htm");
    changeFile(tree, { name: "saved-report.html", size: 200, contents: reportHtml(imported) });
    await flushImport();
    tree = harness.render(SetupImportLink, {
      onImported: () => { context.onImportedCalls += 1; },
    });

    assert.deepEqual(context.store.calls.map(([name]) => name), [
      "setDomainForm", "setCrawledPages", "setSelectedPages", "setSetupImportNotice",
    ]);
    assert.deepEqual(context.store.calls[0][1], {
      companyName: "Imported Company",
      url: "https://imported.example.test",
      personas: "",
      competitors: Array.from({ length: 5 }, (_, index) => `https://rival-${index}.example.test`),
    });
    assert.deepEqual(context.store.calls[1][1], imported.pages);
    assert.deepEqual(context.store.calls[2][1], imported.pages);
    assert.equal(context.onImportedCalls, 1);
    assert.equal(context.confirmCalls, 0);
    assert.equal(context.store.calls[3][1].source, "block-v2");
    assert.deepEqual(context.store.calls[3][1].warnings, [
      "requested_pages_not_analyzed", "persona_not_found", "competitors_truncated",
    ]);
    const notice = findElement(tree, (node) => node.props?.role === "status");
    assert.ok(notice);
    for (const warning of [
      "domain.import_setup_warn_requested",
      "domain.import_setup_warn_persona",
      "domain.import_setup_warn_competitors",
    ]) {
      assert.ok(textContent(notice).includes(warning), `success notice should include ${warning}`);
    }

    const shortSetup = setupBlock({
      competitors: ["https://short-rival.example.test"],
      pages: ["https://imported.example.test/second", "https://imported.example.test/first"],
    });
    changeFile(tree, { name: "saved-report.htm", size: 100, contents: reportHtml(shortSetup) });
    await flushImport();
    assert.deepEqual(context.store.calls[4][1].competitors, ["https://short-rival.example.test", ""]);
    assert.deepEqual(context.store.calls[5][1], shortSetup.pages);
    assert.deepEqual(context.store.calls[6][1], shortSetup.pages);
    assert.equal(context.onImportedCalls, 2);
    assert.equal(context.confirmCalls, 1, "the second import confirms because the first populated the form");
  });
});

test("malformed, empty-page, oversized and unreadable files show matching errors without mutations", async () => {
  const cases = [
    {
      name: "malformed.html",
      file: () => ({ size: 20, contents: "<html>not an exported report</html>" }),
      label: "domain.import_setup_error_not_report",
    },
    {
      name: "empty-pages.html",
      file: () => ({ size: 20, contents: reportHtml(setupBlock({ pages: [] })) }),
      label: "domain.import_setup_error_no_pages",
    },
    {
      name: "oversized.html",
      file: () => ({ size: 20 * 1024 * 1024 + 1, contents: reportHtml() }),
      label: "domain.import_setup_error_read",
      reads: 0,
    },
    {
      name: "unreadable.html",
      file: () => ({ size: 20, readFailureCount: 1 }),
      label: "domain.import_setup_error_read",
      reads: 1,
    },
  ];
  await withBrowserGlobals(async () => {
    for (const scenario of cases) {
      const context = makeContext();
      const harness = makeHarness();
      installHarness(harness, context);
      let tree = harness.render(SetupImportLink);
      changeFile(tree, { name: scenario.name, ...scenario.file() });
      await flushImport();
      tree = harness.render(SetupImportLink);
      const alert = findElement(tree, (node) => node.props?.role === "alert");
      assert.ok(alert, `${scenario.name} should render an error`);
      assert.equal(textContent(alert), scenario.label);
      assert.deepEqual(context.store.calls, []);
      assert.equal(context.confirmCalls, 0);
      assert.equal(context.reads, scenario.reads ?? 1);
    }
  });
});

test("cancelling overwrite leaves every store value untouched", async () => {
  await withBrowserGlobals(async () => {
    const store = makeStore({
      domainForm: {
        companyName: "Keep this company", url: "https://keep.example.test",
        personas: "Keep these buyers", competitors: ["https://keep-rival.example.test", ""],
      },
      crawledPages: ["https://keep.example.test/old-page"],
      selectedPages: ["https://keep.example.test/old-page"],
    });
    const context = makeContext({ store, confirmAnswer: false });
    const harness = makeHarness();
    installHarness(harness, context);
    let tree = harness.render(SetupImportLink);
    changeFile(tree, { name: "replacement.html", size: 20, contents: reportHtml() });
    await flushImport();
    tree = harness.render(SetupImportLink);

    assert.equal(context.confirmCalls, 1);
    assert.deepEqual(store.calls, []);
    assert.equal(store.domainForm.companyName, "Keep this company");
    assert.deepEqual(store.crawledPages, ["https://keep.example.test/old-page"]);
    assert.deepEqual(store.selectedPages, ["https://keep.example.test/old-page"]);
    assert.equal(store.setupImportNotice, null);
    assert.equal(context.onImportedCalls, 0);
    assert.equal(findElement(tree, (node) => node.props?.role === "alert"), null);
  });
});

test("onBeforeApply runs once before the first store write and not for errors or cancelled imports", async () => {
  await withBrowserGlobals(async () => {
    const store = makeStore({
      domainForm: {
        companyName: "Keep this company", url: "https://keep.example.test",
        personas: "", competitors: [""],
      },
    });
    const context = makeContext({ store, confirmAnswer: false });
    const harness = makeHarness();
    let beforeApplyCalls = 0;
    installHarness(harness, context);
    const props = {
      onBeforeApply: () => {
        beforeApplyCalls += 1;
        store.timeline.push("onBeforeApply");
      },
    };

    let tree = harness.render(SetupImportLink, props);
    changeFile(tree, { name: "malformed.html", size: 10, contents: "<html>no report</html>" });
    await flushImport();
    assert.equal(beforeApplyCalls, 0);
    assert.deepEqual(store.timeline, []);

    tree = harness.render(SetupImportLink, props);
    changeFile(tree, { name: "cancelled.html", size: 10, contents: reportHtml() });
    await flushImport();
    assert.equal(context.confirmCalls, 1);
    assert.equal(beforeApplyCalls, 0);
    assert.deepEqual(store.timeline, []);
    assert.equal(store.domainForm.companyName, "Keep this company");

    context.confirmAnswer = true;
    tree = harness.render(SetupImportLink, props);
    changeFile(tree, { name: "accepted.html", size: 10, contents: reportHtml() });
    await flushImport();
    assert.equal(beforeApplyCalls, 1);
    assert.deepEqual(store.timeline, [
      "onBeforeApply", "setDomainForm", "setCrawledPages", "setSelectedPages", "setSetupImportNotice",
    ]);
  });
});

test("resetting the picker after a read error allows retrying the same file", async () => {
  await withBrowserGlobals(async () => {
    const context = makeContext();
    const harness = makeHarness();
    installHarness(harness, context);
    const file = {
      name: "retryable-report.html",
      size: 20,
      contents: reportHtml(),
      readFailureCount: 1,
    };
    let tree = harness.render(SetupImportLink);
    const input = changeFile(tree, file);
    await flushImport();
    tree = harness.render(SetupImportLink);
    assert.equal(textContent(findElement(tree, (node) => node.props?.role === "alert")),
      "domain.import_setup_error_read");

    const retryInput = changeFile(tree, file);
    assert.equal(retryInput.props.accept, ".html,.htm");
    await flushImport();
    tree = harness.render(SetupImportLink);
    assert.equal(context.reads, 2);
    assert.deepEqual(context.store.calls.map(([name]) => name), [
      "setDomainForm", "setCrawledPages", "setSelectedPages", "setSetupImportNotice",
    ]);
    assert.ok(findElement(tree, (node) => node.props?.role === "status"));
    assert.equal(findElement(tree, (node) => node.props?.role === "alert"), null);
    assert.equal(context.onImportedCalls, 0);
    assert.ok(input);
  });
});

test("an actual import resets stale prefill mutation output without calling analysis or AI hooks", async () => {
  await withBrowserGlobals(async () => {
    const store = makeStore({
      domainForm: {
        companyName: "Old Company", url: "https://old.example.test",
        personas: "Old audience", competitors: ["https://stale-rival.example.test", ""],
      },
    });
    const context = makeContext({
      store,
      auth: { isAuthenticated: true, user: { role: "admin" }, permissions: {} },
      prefillMutation: {
        ...makeContext().prefillMutation,
        isSuccess: true,
        data: { content_summary: "stale prefill suggestion" },
      },
    });
    const viewHarness = makeHarness();
    installHarness(viewHarness, context);
    viewHarness.render(DomainAnalyseView);
    let view = viewHarness.render(DomainAnalyseView);
    assert.ok(textContent(view).includes("domain.prefill_success"));
    assert.ok(textContent(view).includes("stale prefill suggestion"));
    const importLink = findElement(view, (node) => typeof node.props?.onBeforeApply === "function");
    assert.ok(importLink);

    const importHarness = makeHarness();
    installHarness(importHarness, context);
    const importTree = importHarness.render(SetupImportLink, {
      onBeforeApply: importLink.props.onBeforeApply,
    });
    changeFile(importTree, {
      name: "actual-import.html",
      size: 100,
      contents: reportHtml(setupBlock({
        companyName: "Imported Company",
        competitors: ["https://fresh-rival.example.test"],
        pages: ["https://imported.example.test/one"],
      })),
    });
    await flushImport();

    installHarness(viewHarness, context);
    view = viewHarness.render(DomainAnalyseView);
    view = viewHarness.render(DomainAnalyseView);
    assert.equal(context.prefillMutation.resetCalls, 2);
    assert.equal(context.prefillMutation.isSuccess, false);
    assert.ok(!textContent(view).includes("domain.prefill_success"));
    assert.ok(!textContent(view).includes("stale prefill suggestion"));
    assert.equal(byTestId(view, "input-company-name").props.value, "Imported Company");
    assert.equal(byTestId(view, "input-competitor-0").props.value, "https://fresh-rival.example.test");
    assert.deepEqual(store.crawledPages, ["https://imported.example.test/one"]);
    assert.deepEqual(store.selectedPages, ["https://imported.example.test/one"]);
    assert.deepEqual(context.startAnalysis.mutateCalls, []);
    assert.deepEqual(context.prefillMutation.mutateCalls, []);
  });
});

test("imports synchronously invalidate old and repeated in-flight AI prefill callbacks before store writes", async () => {
  await withBrowserGlobals(async () => {
    const store = makeStore({
      domainForm: {
        companyName: "Starting Company",
        url: "https://starting.example.test",
        personas: "",
        competitors: [""],
      },
    });
    const context = makeContext({ store });
    const viewHarness = makeHarness();
    installHarness(viewHarness, context);

    let view = viewHarness.render(DomainAnalyseView);
    const firstImportLink = findElement(view, (node) => typeof node.props?.onBeforeApply === "function");
    assert.ok(firstImportLink);
    const firstPrefillButton = byTestId(view, "button-ai-prefill");
    assert.ok(firstPrefillButton);
    firstPrefillButton.props.onClick();
    const firstSuccess = context.prefillMutation.mutateCalls[0]?.[1]?.onSuccess;
    assert.equal(typeof firstSuccess, "function");

    const importHarness = makeHarness();
    installHarness(importHarness, context);
    let importTree = importHarness.render(SetupImportLink, {
      onBeforeApply: firstImportLink.props.onBeforeApply,
    });
    changeFile(importTree, {
      name: "first-import.html",
      size: 100,
      contents: reportHtml(setupBlock({
        companyName: "First Imported Company",
        url: "https://first-imported.example.test",
        persona: "First imported persona",
        competitors: ["https://first-rival.example.test"],
        pages: ["https://first-imported.example.test/page"],
      })),
    });
    await flushImport();

    assert.deepEqual(store.timeline.slice(0, 5), [
      "prefill-reset", "setDomainForm", "setCrawledPages", "setSelectedPages", "setSetupImportNotice",
    ]);
    const firstImportedForm = {
      companyName: "First Imported Company",
      url: "https://first-imported.example.test",
      personas: "First imported persona",
      competitors: ["https://first-rival.example.test", ""],
    };
    firstSuccess({
      personas: "Obsolete first response",
      competitors: [{ url: "https://obsolete-first-rival.example.test", verified: true }],
    });
    assert.deepEqual(store.domainForm, firstImportedForm,
      "a callback delivered after import writes but before the notice effect cannot overwrite imported fields");

    installHarness(viewHarness, context);
    view = viewHarness.render(DomainAnalyseView);
    view = viewHarness.render(DomainAnalyseView);
    const switchToAi = byTestId(view, "button-switch-to-ai");
    assert.ok(switchToAi);
    switchToAi.props.onClick();
    view = viewHarness.render(DomainAnalyseView);
    const secondImportLink = findElement(view, (node) => typeof node.props?.onBeforeApply === "function");
    const secondPrefillButton = byTestId(view, "button-ai-prefill");
    assert.ok(secondPrefillButton);
    secondPrefillButton.props.onClick();
    const secondSuccess = context.prefillMutation.mutateCalls[1]?.[1]?.onSuccess;
    assert.equal(typeof secondSuccess, "function");

    const timelineStart = store.timeline.length;
    installHarness(importHarness, context);
    importTree = importHarness.render(SetupImportLink, {
      onBeforeApply: secondImportLink.props.onBeforeApply,
    });
    changeFile(importTree, {
      name: "second-import.htm",
      size: 100,
      contents: reportHtml(setupBlock({
        companyName: "Second Imported Company",
        url: "https://second-imported.example.test",
        persona: "Second imported persona",
        competitors: ["https://second-rival.example.test"],
        pages: ["https://second-imported.example.test/page"],
      })),
    });
    await flushImport();

    assert.deepEqual(store.timeline.slice(timelineStart, timelineStart + 5), [
      "prefill-reset", "setDomainForm", "setCrawledPages", "setSelectedPages", "setSetupImportNotice",
    ], "each repeated import invalidates the active prefill before applying any store changes");
    const secondImportedForm = {
      companyName: "Second Imported Company",
      url: "https://second-imported.example.test",
      personas: "Second imported persona",
      competitors: ["https://second-rival.example.test", ""],
    };
    secondSuccess({
      personas: "Obsolete second response",
      competitors: [{ url: "https://obsolete-second-rival.example.test", verified: true }],
    });
    assert.deepEqual(store.domainForm, secondImportedForm,
      "a second import in the same view lifetime invalidates the subsequently started prefill too");
    assert.equal(context.prefillMutation.mutateCalls.length, 2);
    assert.deepEqual(context.startAnalysis.mutateCalls, []);
  });
});