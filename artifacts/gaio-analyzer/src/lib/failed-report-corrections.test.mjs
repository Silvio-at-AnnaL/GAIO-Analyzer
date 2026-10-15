import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Window } from "happy-dom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { outputFiles } = await build({
  stdin: { contents: `export { generateHtmlReport } from "./report-export";
    export { crawlFailureNextSteps } from "./crawl-errors";
    export { defaultTechnicalT } from "./technical-breakdown";
    export { PrefillCompetitorDropNote } from "../components/PrefillCompetitorDropNote";`,
    resolveDir: new URL(".", import.meta.url).pathname, loader: "tsx" },
  bundle: true, platform: "node", format: "esm", write: false, jsx: "automatic",
  define: { "import.meta.env.BASE_URL": '"/"' },
  plugins: [{ name: "render-corrections", setup(b) {
    b.onResolve({filter:/^react(?:-dom)?(?:\/.*)?$/}, args=>({path:import.meta.resolve(args.path),external:true}));
    b.onResolve({filter:/LabelProvider$/},()=>({path:"labels",namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export const useT = () => globalThis.__dropNoteT;"}));
  }}],
});
const { generateHtmlReport, crawlFailureNextSteps, defaultTechnicalT: t, PrefillCompetitorDropNote } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
function fixture(code, succeeded = 0) {
  return {status:"failed",url:"https://example.test",errorCode:code,errors:["Legacy reason"],crawledPages:[],
    crawlReliability:{attempted:1,succeeded,failed:succeeded ? 0 : 1,failures:[]},
    blockedRobotsHint:{generalRule:"partial",fullyBlockedAgents:["bingbot"],crawlers:[{name:"GPTBot",status:"not_mentioned"}]}};
}
function doc(html) {
  const window = new Window(); window.document.write(html);
  return window.document;
}
async function report(data, translate = t) {
  const before = globalThis.fetch; globalThis.fetch = async()=>({ok:false});
  try {return await generateHtmlReport(data,{t:translate});}
  finally {globalThis.fetch = before;}
}
function value(document, label) {
  return [...document.querySelectorAll(".detail-item")].find(item=>item.querySelector(".label")?.textContent === label)?.querySelector(".val");
}
const codes = ["crawl_bot_protection","crawl_parked_domain","crawl_timed_out","crawl_no_selected_page","crawl_unreachable"];
for (const code of [...codes, undefined]) {
  test(`failed report ${code ?? "legacy"}: neutral zero successes, one reliability heading, translated steps`, async()=>{
    const document = doc(await report(fixture(code)));
    const cell = value(document,"Erfolgreich abgerufen");
    assert.equal(cell.textContent,"0");
    assert.equal(cell.getAttribute("style"),null);
    assert.equal([...document.querySelectorAll("h2,h3,div")].filter(el=>el.textContent.trim()==="Crawl-Zuverlässigkeit").length,1);
    const heading = [...document.querySelectorAll("h2")].find(el=>el.textContent==="Nächste Schritte");
    const actual = [...heading.nextElementSibling.querySelectorAll("li")].map(el=>el.textContent);
    assert.deepEqual(actual,crawlFailureNextSteps({errorCode:code},t).steps);
    if(code==="crawl_bot_protection") assert.ok(actual[0].includes("GAIOAnalyzer/1.0"));
    if(code==="crawl_parked_domain") assert.ok(!actual.join(" ").includes("Antwortzeiten"));
  });
}

test("legacy next steps preserve the three original sentences verbatim",()=>{
  assert.deepEqual(crawlFailureNextSteps({}).steps,[
    "Erreichbarkeit und Antwortzeiten der Website prüfen.",
    "Fehlerhafte oder nicht erreichbare URLs bereinigen.",
    "Nach der Behebung eine erneute GAIO-Analyse durchführen.",
  ]);
});

test("positive successes are green with a tick; successful report already has one reliability heading",async()=>{
  const document = doc(await report({...fixture(undefined,1),status:"completed",crawledPages:["https://example.test"]}));
  assert.equal(value(document,"Erfolgreich abgerufen").textContent,"✓ 1");
  assert.equal(value(document,"Erfolgreich abgerufen").style.color,"#22c55e");
  assert.equal([...document.querySelectorAll("h2,h3,div")].filter(el=>el.textContent.trim()==="Crawl-Zuverlässigkeit").length,1);
});

test("failed-report heading and steps honor and escape label overrides, including legacy reports",async()=>{
  for (const code of ["crawl_bot_protection","crawl_parked_domain",undefined]) {
    const key = code ? `errors.${code}_next_steps` : "errors.next_steps_default";
    const translate = (label,params)=>label==="errors.next_steps_title" ? "Custom <heading>"
      : label===key ? "First <step>\nSecond & step" : t(label,params);
    const html = await report(fixture(code),translate);
    assert.ok(html.includes("Custom &lt;heading&gt;"));
    assert.ok(html.includes('<div class="section-divider"><span>Custom &lt;heading&gt;</span></div>'));
    assert.ok(html.includes("<li>First &lt;step&gt;</li>"));
    assert.ok(html.includes("<li>Second &amp; step</li>"));
  }
});

test("red failure box headings and paragraphs override global styles",async()=>{
  const document = doc(await report(fixture("crawl_bot_protection")));
  const box = document.querySelector('div[style*="background:#fef2f2"]');
  assert.equal(box.querySelector("h2").style.margin,"0px 0px 12px");
  assert.equal(box.querySelector("h2").style.padding,"0px");
  assert.equal(box.querySelector("h2").style.border,"0px");
  assert.equal(box.querySelector("h2").style.color,"#b91c1c");
  for(const p of box.querySelectorAll("p")) {
    assert.equal(p.style.fontSize,"13px");
    assert.equal(p.style.color,"#4a4d57");
  }
  assert.equal(box.querySelector("h3").style.fontSize,"14px");
  assert.equal(box.querySelector("h3").style.border,"0px");
});

function note(data,translate=t) {
  globalThis.__dropNoteT=translate;
  return renderToStaticMarkup(React.createElement(PrefillCompetitorDropNote,{data}));
}
test("drop note (5 unfit, 2 unreachable, 1 duplicate) names each cause with correct plurals",()=>{
  const document=doc(note({droppedUnfit:5,droppedUnreachable:2,droppedDuplicateCompany:1}));
  assert.equal(document.querySelector("p").textContent,"8 KI-Vorschläge wurden verworfen:");
  assert.deepEqual([...document.querySelectorAll("li")].map(el=>el.textContent),["5 fachlich unpassend","2 nicht erreichbar","1 Dublette"]);
});
test("drop note (1 unfit only) uses singular and omits zero parts",()=>{
  const document=doc(note({droppedUnfit:1,droppedUnreachable:0,droppedDuplicateCompany:0}));
  assert.equal(document.querySelector("p").textContent,"1 KI-Vorschlag wurde verworfen:");
  assert.deepEqual([...document.querySelectorAll("li")].map(el=>el.textContent),["1 fachlich unpassend"]);
});
test("drop note with zero total or absent old counters is hidden",()=>{
  assert.equal(note({droppedUnfit:0,droppedUnreachable:0,droppedDuplicateCompany:0}),"");
  assert.equal(note({}),"");
});
test("drop note uses separate translated keys for singular and plural causes",()=>{
  const keys=[];
  const translate=(key,params)=>{keys.push(key);return t(key,params);};
  const html=note({droppedUnfit:1,droppedUnreachable:1,droppedDuplicateCompany:2},translate);
  assert.ok(html.includes("2 Dubletten"));
  assert.deepEqual(keys,["domain.competitor_dropped_intro_other","domain.competitor_dropped_unfit_one",
    "domain.competitor_dropped_unreachable_one","domain.competitor_dropped_duplicate_other"]);
});
test("prefill view uses the breakdown component, not the obsolete total-only note",async()=>{
  const source=await readFile(new URL("../views/DomainAnalyseView.tsx",import.meta.url),"utf8");
  assert.match(source,/<PrefillCompetitorDropNote data=\{prefillMutation.data\}/);
  assert.ok(!source.includes('t("domain.competitor_dropped_note"'));
});
