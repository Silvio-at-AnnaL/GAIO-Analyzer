import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

globalThis.__competitorSearchLogs = [];
const mocks = {
  "@workspace/integrations-anthropic-ai": `export const anthropic = {};`,
  "./admin-db.js": `export async function getSetting() {throw Error("real settings forbidden in tests");}`,
  "./prompt-manager.js": `export async function getPrompt() {return "{{COMPANY_SUMMARY}} {{MARKET_REGION}}";}
    export function fillTemplate(t, vars) {return Object.entries(vars).reduce((s,[k,v])=>s.replaceAll("{{"+k+"}}",v),t);}`,
  "./logger.js": `export const logger = {info(obj, msg){globalThis.__competitorSearchLogs.push({obj,msg});}};`,
};
const { outputFiles } = await build({
  entryPoints: [new URL("./competitor-sources.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{name:"search-logs",setup(b){
    b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:"mock"}:undefined);
    b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:mocks[args.path]}));
  }}],
});
const { findCandidatesBySearch } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
for (const generated of ["ANFRAGE: Hochdruckpumpen Hersteller\nANFRAGE: Wasserstrahltechnik DACH", "invalid query format"]) {
  test(`search logs final queries before fetching: ${generated.slice(0, 30)}`, async () => {
    globalThis.__competitorSearchLogs = [];
    const requested = [];
    const result = await findCandidatesBySearch("Hochdruckpumpen und Systeme für industrielle Reinigung", "DACH", "own.test", {
      readSetting: async key => key === "search_provider" ? "tavily" : "synthetic-test-key",
      generateQueries: async prompt => {
        assert.ok(prompt.includes("Hochdruckpumpen und Systeme"));
        return generated;
      },
      fetcher: async (_url, options) => {
        const logged = globalThis.__competitorSearchLogs.find(log => log.msg === "Prefill: competitor search queries");
        assert.ok(logged);
        requested.push(JSON.parse(options.body).query);
        return new Response(JSON.stringify({results:[]}),{headers:{"content-type":"application/json"}});
      },
    });
    const logged = globalThis.__competitorSearchLogs.find(log => log.msg === "Prefill: competitor search queries");
    assert.deepEqual(logged.obj, {queries:result.queries});
    assert.deepEqual(requested, result.queries);
    assert.ok(!JSON.stringify(logged).includes("synthetic-test-key"));
  });
}
