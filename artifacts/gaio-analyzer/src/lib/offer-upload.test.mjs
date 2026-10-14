import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [new URL("./offer-upload.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { readOfferUploadScores, isFailedUploadReport, classifyOfferUploadRecommendations } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

const expected = {
  technicalSeo: 0, schemaOrg: 22, headingStructure: 33,
  contentRelevance: 44, faqQuality: 55, llmDiscoverability: 66,
};
const empty = Object.fromEntries(Object.keys(expected).map((key) => [key, null]));

test("short report keys map to the long offer request keys", () => {
  assert.deepEqual(readOfferUploadScores({ scores: {
    technical: 0, schema: 22, headings: 33, content: 44, faq: 55, llm: 66,
  } }), expected);
});

test("legacy long keys are accepted as fallback", () => {
  assert.deepEqual(readOfferUploadScores({ scores: expected }), expected);
});

test("mixed keys prefer short values, retain zero and fall back for nullish values", () => {
  assert.deepEqual(readOfferUploadScores({ scores: {
    technical: 0, technicalSeo: 99, schemaOrg: "22", headings: "33",
    content: null, contentRelevance: 44, faq: undefined, faqQuality: 55,
    llm: 66, llmDiscoverability: 99,
  } }), expected);
});

test("null and missing scores remain null, not zero", () => {
  for (const data of [{}, { scores: null }, { scores: {} }, { scores: {
    technical: null, schema: undefined, headingStructure: null, content: null, faq: null, llm: null,
  } }]) assert.deepEqual(readOfferUploadScores(data), empty);
});

test("non-numeric and non-finite scores remain null", () => {
  for (const value of ["invalid", "", "  ", Infinity, -Infinity, NaN, "Infinity", true, [], {}]) {
    assert.equal(readOfferUploadScores({ scores: { technical: value, technicalSeo: 99 } }).technicalSeo, null);
  }
});

test("failed status is rejected, completed and missing status are not", () => {
  assert.equal(isFailedUploadReport({ status: "failed" }), true);
  assert.equal(isFailedUploadReport({ status: "completed" }), false);
  assert.equal(isFailedUploadReport({}), false);
});

test("failed report error has the requested German default in the offer group", async () => {
  const { outputFiles } = await build({
    entryPoints: [new URL("./labelDefaults.ts", import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", write: false,
  });
  const { labelDefaults } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
  );
  assert.deepEqual(labelDefaults["offer.err_failed_report"], {
    group: "offer",
    de: "Dieser Report stammt von einer fehlgeschlagenen Analyse und kann nicht für ein Angebot verwendet werden.",
  });
});

test("all three methodology legend boxes are skipped without a fix element", () => {
  const items = ["KRITISCH", "HOHER HEBEL", "NACHGEORDNET"].map((tier) => ({
    tier, finding: "Synthetic legend example", fix: "", hasFixElement: false,
  }));
  assert.deepEqual(classifyOfferUploadRecommendations(items), {
    kritisch: [], hoherHebel: [], nachgeordnet: [],
  });
});

test("real recommendations are classified per tier including SEKUNDÄR", () => {
  const item = (tier, finding) => ({ tier, finding, fix: " Synthetic fix ", hasFixElement: true });
  assert.deepEqual(classifyOfferUploadRecommendations([
    item(" KRITISCH ", " Critical "), item("Hoher Hebel", "High"),
    item("NACHGEORDNET", "Secondary"), item("SEKUNDÄR", "Legacy secondary"),
    item("unknown", "Ignored"),
  ]), {
    kritisch: [{ finding: "Critical", fix: "Synthetic fix" }],
    hoherHebel: [{ finding: "High", fix: "Synthetic fix" }],
    nachgeordnet: [
      { finding: "Secondary", fix: "Synthetic fix" },
      { finding: "Legacy secondary", fix: "Synthetic fix" },
    ],
  });
});

test("empty recommendations are skipped; finding-only and fix-only real items are retained", () => {
  assert.deepEqual(classifyOfferUploadRecommendations([
    { tier: "KRITISCH", finding: " ", fix: "\n", hasFixElement: true },
    { tier: "KRITISCH", finding: "Finding", fix: "", hasFixElement: true },
    { tier: "HOHER HEBEL", finding: "", fix: "Fix", hasFixElement: true },
  ]), {
    kritisch: [{ finding: "Finding", fix: "" }],
    hoherHebel: [{ finding: "", fix: "Fix" }],
    nachgeordnet: [],
  });
});
