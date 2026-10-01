import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [new URL("./setup-import.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
});
const {
  MAX_SETUP_FILE_BYTES, hasSetupContent, setupToDomainForm, prepareSetupImport, formatSetupExportDate,
} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

const empty = { companyName: "", url: "", personas: "", competitors: [""] };
const setupBlock = {
  blockVersion: 2, status: "completed", mode: "url", url: "https://example.test",
  companyName: "Example Workshop", persona: "Technical buyers",
  competitors: ["https://rival.example.test"],
  pages: ["https://example.test/z", "https://example.test/a"],
  requestedPages: null, pageSelection: "auto", exportDate: null, analysisId: "synthetic-import",
};
const html = (data = setupBlock) => `<script id="gaio-analysis-data" type="application/json">${JSON.stringify(data)}</script>`;
const options = (overrides = {}) => ({
  readText: async () => html(), hasContent: () => false,
  confirm: () => { throw new Error("Should not ask for an empty form"); }, ...overrides,
});

test("prepares a valid setup locally, preserving page order and replacing all form fields", async () => {
  const result = await prepareSetupImport({ size: 500 }, options());
  assert.equal(result.ok, true);
  assert.deepEqual(result.parsed.setup.pages, setupBlock.pages);
  assert.deepEqual(setupToDomainForm(result.parsed.setup), {
    companyName: "Example Workshop", url: "https://example.test", personas: "Technical buyers",
    competitors: ["https://rival.example.test", ""],
  });
});

test("keeps the usual competitor empty row, importing at most the first five without normalization", () => {
  const setup = { url: null, companyName: null, persona: null, competitors: [] };
  assert.deepEqual(setupToDomainForm(setup), empty);
  const competitors = Array.from({ length: 7 }, (_, i) => `https://rival-${i}.example.test`);
  assert.deepEqual(setupToDomainForm({ ...setup, competitors }).competitors, competitors.slice(0, 5));
  assert.deepEqual(setupToDomainForm({ ...setup, competitors: competitors.slice(0, 4) }).competitors,
    [...competitors.slice(0, 4), ""]);
});

test("any populated form field or page list requires overwrite confirmation", () => {
  assert.equal(hasSetupContent(empty, [[], []]), false);
  for (const key of ["companyName", "url", "personas"]) {
    assert.equal(hasSetupContent({ ...empty, [key]: " value " }, []), true);
  }
  assert.equal(hasSetupContent({ ...empty, competitors: ["", " rival.example.test "] }, []), true);
  assert.equal(hasSetupContent(empty, [["https://example.test/page"]]), true);
});

test("cancelled overwrite returns no setup to apply and accepted overwrite returns the new setup", async () => {
  const cancelled = await prepareSetupImport({ size: 1 }, options({
    hasContent: () => true, confirm: () => false,
  }));
  assert.deepEqual(cancelled, { ok: false, cancelled: true });
  const accepted = await prepareSetupImport({ size: 1 }, options({
    hasContent: () => true, confirm: () => true,
  }));
  assert.equal(accepted.ok, true);
});

test("over-limit files are rejected before reading; read failures get the read error", async () => {
  const rejected = await prepareSetupImport({ size: MAX_SETUP_FILE_BYTES + 1 }, options({
    readText: async () => { throw new Error("Must not read oversized files"); },
  }));
  assert.deepEqual(rejected, { ok: false, reason: "read" });
  assert.equal((await prepareSetupImport({ size: MAX_SETUP_FILE_BYTES }, options())).ok, true);
  assert.deepEqual(await prepareSetupImport({ size: 1 }, options({
    readText: async () => { throw new Error("Synthetic read failure"); },
  })), { ok: false, reason: "read" });
});

test("invalid, failed and empty-page reports never reach overwrite confirmation", async () => {
  for (const [text, reason] of [
    ["<html>not a report</html>", "not_a_report"],
    [html({ ...setupBlock, status: "failed" }), "failed_report"],
    [html({ ...setupBlock, pages: [] }), "no_pages"],
    [html({ ...setupBlock, mode: "html" }), "html_mode"],
    [html({ ...setupBlock, url: null }), "no_setup_data"],
  ]) {
    assert.deepEqual(await prepareSetupImport({ size: 1 }, options({
      readText: async () => text, hasContent: () => true,
    })), { ok: false, reason });
  }
});

test("confirmation checks current content after reading, not stale pre-upload content", async () => {
  let occupied = false;
  let asked = false;
  await prepareSetupImport({ size: 1 }, options({
    readText: async () => { occupied = true; return html(); },
    hasContent: () => occupied, confirm: () => { asked = true; return false; },
  }));
  assert.equal(asked, true);
});

test("success dates use German formatting with the specified missing-date fallback", () => {
  assert.equal(formatSetupExportDate(null), "unbekanntem Datum");
  assert.equal(formatSetupExportDate("invalid"), "unbekanntem Datum");
  const date = "2026-10-01T10:00:00Z";
  assert.equal(formatSetupExportDate(date), new Date(date).toLocaleString("de-DE"));
});