import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [new URL("./faq.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "extraction-only",
    setup(builder) {
      builder.onResolve({ filter: /^cheerio$/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
      builder.onResolve({ filter: /\/(?:ai-client|prompt-manager|logger)(?:\.js)?$/ }, () => ({ path: "services", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
        contents: `export function callLLM(){throw Error("not used");}
          export function getPrompt(){throw Error("not used");}
          export function fillTemplate(){throw Error("not used");}
          export const logger={warn(){}};`,
      }));
    },
  }],
});
const { extractFaqPairs } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const extract = html => extractFaqPairs([{ html }]).visible;
const answer = n => `Antwort ${n}: Diese ausführliche Erklärung gehört ausschließlich zur zugehörigen Frage und ist lang genug.`;

test("stacked header/h3 accordions ignore empty icons and retain only their own answers", () => {
  const html = [1, 2, 3].map(n => `<div class="accordion-item"><div class="wrapper">
    <header><h3>Wie funktioniert Verfahren ${n}?</h3><i></i><button></button></header>
    <div aria-expanded="false"><p>${answer(n)}</p></div>
    </div></div>`).join("");
  assert.deepEqual(extract(html), [1, 2, 3].map(n => ({ question: `Wie funktioniert Verfahren ${n}?`, answer: answer(n) })));
});

test("direct sibling answers stop at a sibling containing any h1–h6 heading", () => {
  for (let level = 1; level <= 6; level++) {
    const pairs = extract(`<h3>Was ist das erste Verfahren?</h3><p>${answer(1)}</p>
      <article><h${level}>Zweite Rubrik</h${level}><p>${answer(2)}</p></article><p>${answer(3)}</p>`);
    assert.deepEqual(pairs, [{ question: "Was ist das erste Verfahren?", answer: answer(1) }]);
  }
});

test("ancestor-climbed answers stop before the next item containing a heading", () => {
  const pairs = extract(`<section><header><h3>Wie funktioniert es?</h3></header>
    <p>${answer(1)}</p><div><h4>Was folgt danach?</h4><p>${answer(2)}</p></div></section>`);
  assert.equal(pairs[0].answer, answer(1));
});

test("a parent with additional text must not be climbed", () => {
  assert.deepEqual(extract(`<header>Zusatztext<h3>Wie funktioniert es?</h3></header><p>${answer(1)}</p>`), []);
});

test("ancestor climbing is limited to three parent levels", () => {
  assert.equal(extract(`<div><header><span><h3>Wie funktioniert es?</h3></span></header></div><p>${answer(1)}</p>`).length, 1);
  assert.deepEqual(extract(`<div><div><header><span><h3>Wie funktioniert es?</h3></span></header></div></div><p>${answer(1)}</p>`), []);
});

test("Bootstrap heading/button aria-controls produces one deduplicated pair", () => {
  const pairs = extract(`<h2><button aria-controls="c1">Wie wird das montiert?</button></h2><div id="c1">${answer(1)}</div>`);
  assert.deepEqual(pairs, [{ question: "Wie wird das montiert?", answer: answer(1) }]);
});

test("ARIA question starts work without a question mark and IDs are matched literally", () => {
  assert.deepEqual(extract(`<button aria-controls="a:b[1]">Wie wird das montiert</button>
    <section id="a:b[1]">${answer(1)}</section>`),
  [{ question: "Wie wird das montiert", answer: answer(1) }]);
});

test("ARIA rejects unresolved IDs, non-questions and short answers", () => {
  assert.deepEqual(extract(`<button aria-controls="missing">Wie funktioniert es?</button>
    <button aria-controls="long">Produktübersicht</button><div id="long">${answer(1)}</div>
    <button aria-controls="short">Was ist das?</button><div id="short">Zu kurz.</div>`), []);
});

test("details and direct-sibling extraction and questionKey dedup are preserved", () => {
  const html = `<details><summary>Wie funktioniert es?</summary><p>${answer(1)}</p></details>
    <h3>Was kostet das?</h3><p>${answer(2)}</p><h2>Weitere Informationen</h2>
    <details><summary>wie funktioniert es?</summary><p>${answer(3)}</p></details>`;
  assert.deepEqual(extract(html), [
    { question: "Wie funktioniert es?", answer: answer(1) },
    { question: "Was kostet das?", answer: answer(2) },
  ]);
});

test("heading detection still requires ? and all visible answers require 40 characters", () => {
  assert.deepEqual(extract(`<h3>Wie funktioniert es</h3><p>${answer(1)}</p>
    <h3>Was kostet das?</h3><p>Kurz.</p><details><summary>Was?</summary>Kurz.</details>`), []);
});

test("heading CTA followed by text and a form discards the entire pair rather than truncating it", () => {
  const html = `<h3>Sie möchten eine persönliche telefonische Beratung?</h3>
    <p>${answer(1)}</p><form><label>Name<input name="name"></label></form>`;
  assert.deepEqual(extract(html), []);
});

test("heading answer rejects each form element, directly or nested, while normal accordions remain", () => {
  for (const element of ["form", "input", "textarea", "select"]) {
    for (const nested of [false, true]) {
      const field = `<${element}></${element}>`;
      assert.deepEqual(extract(`<header><h3>Wie funktioniert es?</h3></header>
        <p>${answer(1)}</p>${nested ? `<div>${field}</div>` : field}`), []);
    }
  }
  assert.deepEqual(extract(`<header><h3>Wie funktioniert es?</h3></header><div>${answer(1)}</div>`),
    [{question:"Wie funktioniert es?",answer:answer(1)}]);
});
