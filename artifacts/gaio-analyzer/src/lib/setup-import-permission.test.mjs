import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

async function bundleEntry(entry, plugins = []) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    jsx: "automatic",
    define: { "import.meta.env.BASE_URL": '"/"' },
    plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}

const { ADMIN_FEATURES, ADMIN_NAV_GROUPS } = await bundleEntry("../config/adminFeatures.ts");

test("setup_import is configurable for admins without becoming a navigation item", () => {
  const feature = ADMIN_FEATURES.find(({ id }) => id === "setup_import");
  assert.ok(feature);
  assert.equal(feature.label, "nav.admin_setup_import");
  assert.deepEqual(feature.defaultRoles, ["admin"]);
  assert.equal(feature.isGroup, undefined);
  assert.ok(ADMIN_NAV_GROUPS.every(({ items }) => !items.includes("setup_import")));
});

const compareMocks = {
  react: `
    export function useState(initial) {
      const index = globalThis.__compareTestState.index++;
      return [initial, value => { globalThis.__compareTestState.values[index] = value; }];
    }
    export function useRef(current) { return { current }; }
    export function useCallback(callback) { return callback; }
    export function useEffect() {}
  `,
  "react/jsx-runtime": `
    export const Fragment = Symbol.for("react.fragment");
    export function jsx(type, props, key) { return { type, props, key }; }
    export const jsxs = jsx;
  `,
  "@/store/authStore": `
    export const useAuth = () => ({});
    export const adminFetch = async () => ({});
    export const canAccess = () => false;
  `,
  "@/store/appStore": `export const useAppStore = () => ({});`,
  "@/components/ui/button": `export const Button = () => null;`,
  "@/components/ui/badge": `export const Badge = () => null;`,
  "lucide-react": `
    export const ArrowLeftRight = () => null;
    export const Upload = () => null;
    export const FileSearch = () => null;
    export const RefreshCw = () => null;
    export const Building2 = () => null;
    export const Calendar = () => null;
    export const BarChart3 = () => null;
  `,
  "@/lib/LabelProvider": `
    export const useT = () => key => key;
    export const useLabelContext = () => ({ locale: "de" });
  `,
};

const compareEntry = new URL("../views/VergleichView.tsx", import.meta.url).pathname;
const comparison = await bundleEntry("../views/VergleichView.tsx", [{
  name: "compare-upload-test-mocks",
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => (
      Object.hasOwn(compareMocks, args.path)
        ? { path: args.path, namespace: "compare-test-mock" }
        : undefined
    ));
    builder.onLoad({ filter: /.*/, namespace: "compare-test-mock" }, (args) => ({
      contents: compareMocks[args.path],
      loader: "js",
    }));
    builder.onLoad({ filter: /VergleichView\.tsx$/ }, async (args) => {
      if (args.path !== compareEntry) return undefined;
      const contents = (await readFile(args.path, "utf8")).replace(
        "function FileDropZone(",
        "export function FileDropZone(",
      );
      return { contents, loader: "tsx" };
    });
  },
}]);

function findElement(node, type) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  return findElement(node.props?.children, type);
}

function invokeUpload(content, onLoad) {
  globalThis.__compareTestState = { index: 0, values: [] };
  const root = comparison.FileDropZone({ loaded: false, onLoad });
  const input = findElement(root, "input");
  assert.ok(input);
  class SyntheticFileReader {
    readAsText() {
      this.onload?.({ target: { result: content } });
    }
  }
  const previousFileReader = globalThis.FileReader;
  globalThis.FileReader = SyntheticFileReader;
  try {
    input.props.onChange({ target: { files: [{ name: "synthetic.html" }] } });
  } finally {
    if (previousFileReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = previousFileReader;
  }
  return globalThis.__compareTestState.values[0];
}

test("comparison upload rejects a failed embedded report and accepts a completed one", () => {
  let loaded = null;
  const failedError = invokeUpload(
    '<script type="application/json" id="gaio-analysis-data">{"status":"failed"}</script>',
    (snapshot) => { loaded = snapshot; },
  );
  assert.equal(failedError, "compare.error_failed_report");
  assert.equal(loaded, null);

  const successError = invokeUpload(
    '<script type="application/json" id="gaio-analysis-data">{"status":"completed","domain":"https://example.test"}</script>',
    (snapshot) => { loaded = snapshot; },
  );
  assert.equal(successError, null);
  assert.equal(loaded?.domain, "https://example.test");
});