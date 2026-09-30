import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

async function loadWithMocks(entry, mocks) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [{
      name: "passage-retrieval-test-mocks",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => (
          Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "passage-test" } : undefined
        ));
        builder.onLoad({ filter: /.*/, namespace: "passage-test" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}

const { buildPassages, normalizeTokens, scorePassages, selectForQuestion } = await loadWithMocks(
  "./passage-retrieval.ts",
  {
    "./content-relevance": `
      export function extractMainText(html) {
        const main = html.match(/<main>([\\s\\S]*?)<\\/main>/i)?.[1] ?? html;
        return main.replace(/<[^>]*>/g, "").replace(/\\s+/g, " ").trim();
      }
    `,
    "./faq": `
      export function extractFaqPairs(pages) {
        const distinct = pages.flatMap(({ html }) => {
          const pairs = [];
          const pattern = /<faq data-question="([^"]*)" data-answer="([^"]*)"><\\/faq>/g;
          for (const match of html.matchAll(pattern)) pairs.push({ question: match[1], answer: match[2] });
          return pairs;
        });
        return { schema: [], visible: [], distinct };
      }
    `,
  },
);

function page(url, text, faq = null) {
  const faqMarkup = faq
    ? `<faq data-question="${faq.question}" data-answer="${faq.answer}"></faq>`
    : "";
  return { url, html: `<main>${text}</main>${faqMarkup}` };
}

test("folds umlauts and matches inflected German words", () => {
  const passages = [{ url: "/produkt", kind: "text", text: "Schrumpfschlauch für Kabel." }];
  assert.ok(scorePassages("Schrumpfschläuche", passages)[0].score > 0);
  assert.ok(normalizeTokens("Schrumpfschläuche").includes("schrumpfschlauch"));
});

test("matches compound words in either direction", () => {
  const passages = [{ url: "/produkt", kind: "text", text: "Silikonschrumpfschlauch für Anwendungen." }];
  assert.ok(scorePassages("schrumpfschlauch", passages)[0].score > 0);
  assert.ok(scorePassages("Silikonschrumpfschlauch", [
    { url: "/produkt", kind: "text", text: "schrumpfschlauch" },
  ])[0].score > 0);
});

test("ignores German and English stopwords", () => {
  assert.deepEqual(normalizeTokens("Welche Produkte sollte man für die Anwendung wählen?"), ["produkt", "anwendung", "wahl"]);
  assert.deepEqual(normalizeTokens("What should you use for this?"), []);
});

test("excludes exact normalized company tokens while retaining subject terms", () => {
  const passages = [
    { url: "/footer", kind: "text", text: "Rotima GmbH, Kaufbeuren." },
    { url: "/product", kind: "text", text: "Silikonschrumpfschläuche isolieren Leitungen." },
  ];
  const options = { excludeTerms: ["Rotima GmbH, Kaufbeuren"] };
  const scores = scorePassages("Welche Silikonschrumpfschläuche bietet Rotima GmbH in Kaufbeuren?", passages, options);
  assert.deepEqual(normalizeTokens("Rotima GmbH, Kaufbeuren"), ["rotima", "gmbh", "kaufbeur"]);
  assert.equal(scores[0].score, 0);
  assert.ok(scores[1].score > 0);
  assert.equal(selectForQuestion("Welche Silikonschrumpfschläuche bietet Rotima GmbH in Kaufbeuren?", passages, options).passages[0].url, "/product");
  assert.ok(scorePassages("Silikonschrumpfschlauch", passages, { excludeTerms: ["Silikon"] })[1].score > 0);
});

test("uses fallback when all normalized query tokens are excluded", () => {
  const passages = buildPassages([page("/company", "Rotima GmbH Kaufbeuren.")]);
  assert.equal(selectForQuestion("Rotima GmbH Kaufbeuren", passages, {
    excludeTerms: ["Rotima GmbH, Kaufbeuren"],
  }).fallback, true);
  assert.deepEqual(selectForQuestion("Rotima GmbH Kaufbeuren", passages, {
    excludeTerms: ["Rotima GmbH, Kaufbeuren"],
  }).passages.map(({ url }) => url), ["/company"]);
});

test("keeps an FAQ pair as one passage and removes question and answer from text passages", () => {
  const question = "Welche Temperatur ist möglich?";
  const answer = "Die Temperatur beträgt bis zu 200 Grad.";
  const passages = buildPassages([
    page("/faq", `Produktbeschreibung. ${question} ${answer} Weitere Details.`, { question, answer }),
  ]);
  const faq = passages.find(({ kind }) => kind === "faq");
  assert.equal(faq.text, `F: ${question}\nA: ${answer}`);
  assert.equal(passages.filter(({ kind }) => kind === "faq").length, 1);
  const text = passages.filter(({ kind }) => kind === "text").map(({ text: value }) => value).join(" ");
  assert.ok(!text.includes(question));
  assert.ok(!text.includes(answer));
  assert.ok(text.includes("Produktbeschreibung."));
  assert.ok(text.includes("Weitere Details."));
});

test("deduplicates identical passages across pages and keeps their first URL", () => {
  const passages = buildPassages([page("/first", "Identischer Inhalt."), page("/second", "Identischer Inhalt.")]);
  assert.equal(passages.filter(({ text }) => text === "Identischer Inhalt.").length, 1);
  assert.equal(passages.find(({ text }) => text === "Identischer Inhalt.").url, "/first");
});

test("chunks text at sentence boundaries and keeps every passage within 800 characters", () => {
  const first = `${"A".repeat(480)}.`;
  const second = `${"B".repeat(480)}.`;
  const third = `${"C".repeat(480)}.`;
  const passages = buildPassages([page("/long", `${first} ${second} ${third}`)]);
  assert.ok(passages.length >= 2);
  assert.ok(passages.every(({ text }) => text.length <= 800));
  assert.ok(passages.every(({ text }) => !text.includes("B".repeat(20) + ". " + "C".repeat(20))));
  assert.ok(passages[0].text.endsWith("."));
});

test("selection is ranked by score and remains within the character and passage budgets", () => {
  const passages = Array.from({ length: 12 }, (_, index) => ({
    url: `/page-${index}`,
    kind: "text",
    text: `schrumpfschlauch ${"X".repeat(580)} ${"detail ".repeat(index + 1)}`,
  }));
  const selected = selectForQuestion("schrumpfschlauch", passages);
  assert.equal(selected.fallback, false);
  assert.ok(selected.passages.length <= 8);
  assert.ok(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0) <= 4000);
  assert.deepEqual(
    selected.passages.map(({ score }) => score),
    [...selected.passages.map(({ score }) => score)].sort((a, b) => b - a),
  );
});

test("falls back to the first 400 characters of each page's full main text in page order", () => {
  const passages = buildPassages([
    page("/one", `Erster Seiteneinstieg ${"A".repeat(500)}.`, {
      question: "Erster Seiteneinstieg?",
      answer: `Antwort ${"Z".repeat(500)}`,
    }),
    page("/two", `Zweiter Seiteneinstieg ${"B".repeat(500)}.`),
  ]);
  const selected = selectForQuestion("nicht vorhandener Suchbegriff", passages);
  assert.equal(selected.fallback, true);
  assert.deepEqual(selected.passages.map(({ url }) => url), ["/one", "/two"]);
  assert.deepEqual(selected.passages.map(({ text }) => text.length), [400, 400]);
  assert.ok(selected.passages[0].text.startsWith("Erster Seiteneinstieg"));
  assert.ok(selected.passages[1].text.startsWith("Zweiter Seiteneinstieg"));
  assert.ok(selected.passages.every(({ score }) => score === 0));
});