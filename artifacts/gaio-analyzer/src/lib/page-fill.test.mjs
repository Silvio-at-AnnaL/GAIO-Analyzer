import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { outputFiles } = await build({
  entryPoints: [new URL("./page-fill.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { canFillPages, pageFillOptions } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const source = await readFile(new URL("../views/DomainAnalyseView.tsx", import.meta.url), "utf8");
const pages = Array.from({ length: 20 }, (_, index) => `https://example.test/page-${index}`);

test("fill eligibility is limited to 1–15 selected pages and an existing editable list", () => {
  for (const count of [0, 1, 15, 16, 20]) assert.equal(canFillPages(pages, pages.slice(0, count)), count > 0 && count < 16);
  assert.equal(canFillPages([], [pages[0]]), false);
});

test("unchecked and hidden fill options leave the old request unchanged; opt-in excludes precisely deselected pages", () => {
  assert.deepEqual(pageFillOptions(pages, pages.slice(0, 3), false), {});
  assert.deepEqual(pageFillOptions(pages, [], true), {});
  assert.deepEqual(pageFillOptions(pages, pages.slice(0, 16), true), {});
  assert.deepEqual(pageFillOptions(pages.slice(0, 4), [pages[2], pages[0]], true), {
    fillToMax: true, excludedUrls: [pages[1], pages[3]],
  });
  assert.match(source, /\.\.\.pageFillOptions\(editablePages, selectedPages, fillToMax\)/);
});

test("fill state is local, starts unchecked and resets with replacement lists including an empty list", () => {
  assert.match(source, /\[fillToMax, setFillToMax\] = useState\(false\)/);
  const reset = source.match(/useEffect\(\(\) => \{ setFillToMax\(false\); \}, \[editablePages\]\);/);
  assert.ok(reset);
  const register = new Function("useEffect", "setFillToMax", "editablePages", reset[0]);
  for (const replacement of [pages, [...pages], []]) {
    let checked = true;
    register((callback, deps) => { assert.equal(deps[0], replacement); callback(); }, value => { checked = value; }, replacement);
    assert.equal(checked, false);
  }
  assert.match(source, /setEditablePages\(\[\.\.\.crawledPages\]\)/);
  assert.match(source, /setSelectedPages\(\[\.\.\.crawledPages\]\)/);
});

globalThis.__fillCheckbox = { React, canFillPages };
const start = source.indexOf("{canFillPages(editablePages, selectedPages)");
const end = source.indexOf("{editablePages.length > MAX_VISIBLE_PAGES", start);
assert.ok(start >= 0 && end > start);
const { outputFiles: checkboxFiles } = await build({
  stdin: { loader: "tsx", contents: `
    const {React, canFillPages} = globalThis.__fillCheckbox;
    export function Checkbox({editablePages, selectedPages, fillToMax = false}) {
      const setFillToMax = () => {};
      const t = key => key;
      return <>${source.slice(start, end)}</>;
    }` },
  format: "esm", write: false,
});
const { Checkbox } = await import(`data:text/javascript;base64,${Buffer.from(checkboxFiles[0].contents).toString("base64")}`);
test("the real checkbox fragment uses the requested label and visibility rules", () => {
  for (const count of [0, 1, 15, 16]) {
    const html = renderToStaticMarkup(React.createElement(Checkbox, { editablePages: pages, selectedPages: pages.slice(0, count) }));
    assert.equal(html.includes('type="checkbox"'), count > 0 && count < 16);
    if (count > 0 && count < 16) {
      assert.ok(html.includes("domain.fill_pages_option"));
      assert.ok(!html.includes("checked"));
      assert.ok(!html.includes("font-size:"));
    }
  }
});
