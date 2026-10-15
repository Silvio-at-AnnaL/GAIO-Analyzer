import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [new URL("./language-path.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { getPathLanguage, LANG_PREFIX_RE, WEB_LANGUAGE_CODES } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`,
);
test("language prefixes accept the exact curated list with optional regions and case normalisation", () => {
  assert.equal(WEB_LANGUAGE_CODES.join(" "), "de en fr it es pt nl pl cs sk hu ro bg hr sl sr ru uk tr el sv da no nb nn fi et lv lt ja zh ko ar he hi th vi id ms");
  for (const code of WEB_LANGUAGE_CODES) {
    assert.equal(getPathLanguage(`/${code}/products`), code);
    assert.equal(getPathLanguage(`/${code.toUpperCase()}-US/`), code);
  }
  for (const [pathname, expected] of [["/de/", "de"], ["/en-us/", "en"], ["/fr/", "fr"], ["/de-at", "de"], ["/zh-cn/products", "zh"]]) {
    assert.equal(getPathLanguage(pathname), expected);
    assert.ok(LANG_PREFIX_RE.test(pathname));
  }
});
test("ordinary short paths and non-curated codes are not language branches", () => {
  for (const pathname of ["/sc/", "/mc/", "/nxp/", "/bom-tool", "/bom/", "/faq", "/new", "/api/products", "/news", "/depot", "/enough", "/", "/de-invalid/", "/fil/", "/af/"]) {
    assert.equal(getPathLanguage(pathname), null, pathname);
    assert.equal(LANG_PREFIX_RE.test(pathname), false, pathname);
  }
});
