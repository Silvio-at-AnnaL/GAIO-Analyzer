import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const mocks = {
  "./admin-db.js": `export async function getSetting(key) { return globalThis.__usage.settings[key] ?? null; }`,
  "../lib/admin-db.js": `export async function getSetting(key) { return globalThis.__usage.settings[key] ?? null; }`,
  "./db.js": `export async function query(sql, params) {
    const s=globalThis.__usage; s.queries.push({sql,params});
    if (s.fail) throw new Error("synthetic database failure");
    if (s.query) return s.query(sql,params);
    return {rows:[]};
  }`,
  "../lib/db.js": `export { query } from "./db.js";`,
  "./logger.js": `export const logger = Object.fromEntries(["info","warn","error"].map(level=>
    [level,(obj,msg)=>globalThis.__usage.logs.push({level,obj,msg})]));`,
  "../lib/logger.js": `export { logger } from "./logger.js";`,
  "./prompt-manager.js": `export const getPrompt=async()=>""; export const fillTemplate=()=>"";`,
  "@anthropic-ai/sdk": `export default class Anthropic {
    constructor() { this.messages={create:async()=>{
      if(globalThis.__usage.providerFail) throw new Error("provider failed");
      return {content:[{type:"text",text:"ok"}],usage:{input_tokens:1000000,output_tokens:100000}};
    }}; }
  }`,
};
const { outputFiles } = await build({
  stdin: { contents: `export * from "./usage-events.ts";
    export * from "./usage-snapshot.ts";
    export * from "./log-context.ts";
    export {callLLMDetailed} from "./ai-client.ts";
    export {findCandidatesBySearch} from "./competitor-sources.ts";
    export * from "../routes/usage.ts";`,
  resolveDir: new URL(".", import.meta.url).pathname },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "usage-test", setup(b) {
    b.onResolve({filter:/.*/}, args => Object.hasOwn(mocks,args.path) ? {path:args.path,namespace:"mock"} : undefined);
    b.onLoad({filter:/.*/,namespace:"mock"}, args => ({contents:mocks[args.path]}));
  } }],
});
const usage = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
function reset(settings={}) {
  return globalThis.__usage = {settings:{ai_api_key_claude:"synthetic-key",...settings},queries:[],logs:[]};
}
const insertions = state => state.queries.filter(q=>q.sql.includes("INSERT INTO usage_events"));

test("usage environment has explicit override, deployment fallback and dev default",()=>{
  for(const [env,expected] of [
    [{GAIO_ENV:"dev",REPLIT_DEPLOYMENT:"1"},"dev"], [{GAIO_ENV:"live"},"live"],
    [{GAIO_ENV:"invalid",REPLIT_DEPLOYMENT:"1"},"live"], [{REPLIT_DEPLOYMENT:""},"dev"], [{},"dev"],
  ]) assert.equal(usage.detectUsageEnvironment(env),expected);
});
test("all required module areas are mapped at insert",()=>{
  for(const module of ["content-relevance","competitor-content","faq-quality","llm-discoverability-a",
    "llm-discoverability-b","llm-discoverability-rating","competitor-findings","recommendations"]) {
    assert.equal(usage.usageArea(module),"analysis");
  }
  for(const module of ["prefill-main","prefill-url-correction","prefill-replacement","prefill-relevance",
    "competitor-search-queries","competitor-search"]) assert.equal(usage.usageArea(module),"preparation");
  assert.equal(usage.usageArea("offer-creator"),"offer");
  assert.equal(usage.usageArea("preflight"),"system");
  assert.equal(usage.usageArea("unknown"),"other");
});
test("successful callLLMDetailed records one priced event with context IDs and exact usage",async()=>{
  const s=reset();
  await usage.runWithLogContext({analysisId:"analysis-a",prepId:"preparation"},async()=>{
    assert.equal((await usage.callLLMDetailed("test",20,0,{module:"content-relevance"})).text,"ok");
  });
  await usage.drainUsageWrites();
  const rows=insertions(s);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].params,[usage.usageEnvironment,"llm","analysis","content-relevance",
    "claude","claude-sonnet-4-20250514","analysis-a","preparation",1000000,100000,null,4.5]);
});
test("failed calls insert nothing and failed recording does not break successful calls",async()=>{
  let s=reset(); s.providerFail=true;
  await assert.rejects(()=>usage.callLLMDetailed("test"),/provider failed/);
  await usage.drainUsageWrites();
  assert.equal(insertions(s).length,0);
  s=reset(); s.fail=true;
  assert.equal((await usage.callLLMDetailed("test")).text,"ok");
  await usage.drainUsageWrites();
  assert.ok(s.logs.some(l=>l.msg==="usage recording failed"));
});
test("unpriced providers and unavailable tokens retain null cost; malformed price data does not lose the row",async()=>{
  for(const [settings,provider,tokens] of [
    [{ai_prices:"{}"},"custom",1], [{ai_prices:"{}"},"claude",1],
    [{},"claude",null], [{ai_prices:"broken"},"claude",1],
  ]) {
    const s=reset(settings);
    usage.recordUsage({kind:"llm",module:"offer-creator",provider,model:"test",inputTokens:tokens,outputTokens:2});
    await usage.drainUsageWrites();
    assert.equal(insertions(s).length,1);
    assert.equal(insertions(s)[0].params[11],null);
  }
});
test("price validation accepts custom providers and rejects invalid plans/prices before save",()=>{
  assert.equal(usage.validateUsageSettings({ai_prices:JSON.stringify({custom:{inputPerMTok:0,outputPerMTok:2}})}),null);
  for(const body of [
    {ai_prices:"[]"}, {ai_prices:"broken"}, {ai_prices:'{"claude":{"inputPerMTok":-1,"outputPerMTok":15}}'},
    {ai_prices:'{"custom":{"inputPerMTok":"3","outputPerMTok":15}}'},
    {search_plan:"other"}, {search_plan:["free"]}, {search_included_credits:"2.5"}, {search_credit_price_usd:"-1"},
    {search_monthly_price_usd:"Infinity"}, {search_included_credits:""},
  ]) assert.ok(usage.validateUsageSettings(body));
  assert.equal(usage.validateUsageSettings({search_plan:"payg",search_included_credits:"0",search_credit_price_usd:"0.01",search_monthly_price_usd:""}),null);
});
test("Tavily credits use reported usage or depth fallback, and costs are payg-only",async()=>{
  assert.equal(usage.tavilyCredits({usage:{credits:5}}),5);
  assert.equal(usage.tavilyCredits({}),1);
  assert.equal(usage.tavilyCredits({usage:{credits:"2"}},"advanced"),2);
  for(const plan of ["free","payg","package","enterprise"]) {
    const s=reset({search_plan:plan,search_credit_price_usd:"0.01"});
    const result=await usage.runWithLogContext({prepId:"prep"},()=>usage.findCandidatesBySearch("summary","DACH","own.test",{
      readSetting:async key=>key==="search_provider"?"tavily":"synthetic-key",
      generateQueries:async()=>"ANFRAGE: query",
      fetcher:async(_url,options)=>{
        assert.equal(JSON.parse(options.body).include_usage,true);
        return new Response(JSON.stringify({results:[],usage:{credits:3}}));
      },
    }));
    assert.deepEqual(result.candidates,[]);
    await usage.drainUsageWrites();
    const row=insertions(s)[0].params;
    assert.equal(row[1],"search"); assert.equal(row[2],"preparation");
    assert.equal(row[3],"competitor-search"); assert.equal(row[4],"tavily");
    assert.equal(row[7],"prep"); assert.equal(row[10],3);
    assert.equal(row[11],plan==="payg"?0.03:null);
  }
});
test("Tavily 2xx responses lacking usage or valid result JSON still record basic credits",async()=>{
  for(const body of ['{"results":[]}',"invalid-json"]) {
    const s=reset();
    await usage.findCandidatesBySearch("summary","DACH","own.test",{
      readSetting:async key=>key==="search_provider"?"tavily":"synthetic-key", generateQueries:async()=>"ANFRAGE: query",
      fetcher:async()=>new Response(body),
    });
    await usage.drainUsageWrites();
    assert.equal(insertions(s).length,1);
    assert.equal(insertions(s)[0].params[10],1);
  }
});
test("Tavily quota errors warn with status, record no usage and preserve fallback",async()=>{
  for(const status of [432,433]) {
    const s=reset();
    await usage.findCandidatesBySearch("summary","DACH","own.test",{
      readSetting:async key=>key==="search_provider"?"tavily":"synthetic-key",
      generateQueries:async()=>"ANFRAGE: query",fetcher:async()=>new Response("",{status}),
    });
    await usage.drainUsageWrites();
    assert.equal(insertions(s).length,0);
    assert.ok(s.logs.some(l=>l.level==="warn"&&l.msg==="tavily quota exhausted"&&l.obj.status===status));
  }
});
test("snapshot waits for inserts then uses disjoint analysis and prep-only sets; failures are contained",async()=>{
  const s=reset();
  usage.recordUsage({kind:"llm",module:"preflight",provider:"claude",model:"test",inputTokens:1,outputTokens:1});
  await usage.saveUsageSnapshot(10);
  assert.ok(s.queries[0].sql.includes("INSERT INTO usage_events"));
  assert.match(s.queries[1].sql,/'calls', COUNT\(\*\) FILTER \(WHERE analysis_id IS NULL\)/);
  assert.match(s.queries[1].sql,/analysis_id=al.analysis_uuid[\s\S]*OR \(analysis_id IS NULL AND prep_id=al.prep_id\)/);
  assert.match(s.queries[1].sql,/'searchCostUsd', SUM\(cost_usd\) FILTER \(WHERE kind='search' AND analysis_id IS NULL\)/);
  assert.deepEqual(s.queries[1].params,[10]);
  s.fail=true;
  await usage.saveUsageSnapshot(10);
  assert.ok(s.logs.some(l=>l.msg==="usage snapshot failed"));
});

function route(path) {
  const handlers={};
  usage.registerUsageRoutes({get:(path,...fns)=>handlers[path]=fns},()=>{},()=>{});
  return handlers[path].at(-1);
}
function response() {
  return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},
    json(v){this.body=v;},send(v){this.body=v;}};
}
test("summary filters default live, validate dates, and group by area/module/model without multiplying shared prep",async()=>{
  assert.deepEqual(usage.usageFilters({query:{}}).params,[null,null,"live"]);
  assert.deepEqual(usage.usageFilters({query:{env:"all"}}).params,[null,null,null]);
  for(const query of [{env:"bad"},{from:"not-a-date"},{to:"2026-02-30"}]) assert.ok(usage.usageFilters({query}).error);
  const s=reset();
  s.query=sql=>({rows:sql.includes('AS "analysesCount"')?[{inputTokens:10,outputTokens:5,costUsd:1,
    searchCredits:3,searchCostUsd:null,analysesCount:2,avgCostPerAnalysis:0.5}]
    :sql.includes(" AS used")?[{used:3}]:[]});
  const res=response();
  await route("/usage/summary")({query:{from:"2026-10-16",to:"2026-10-16",env:"dev"}},res);
  assert.equal(res.body.analysesCount,2);
  assert.deepEqual(res.body.searchMonth,{used:3,included:1000,plan:"free"});
  for(const column of ["area","module","model"]) assert.ok(s.queries.some(q=>q.sql.includes(`GROUP BY ${column}`)));
  assert.ok(s.queries.slice(0,4).every(q=>JSON.stringify(q.params)===JSON.stringify(["2026-10-16","2026-10-16","dev"])));
  assert.match(s.queries[0].sql,/Europe\/Berlin/);
  assert.match(s.queries[0].sql,/COUNT\(DISTINCT analysis_id\)/);
  assert.match(s.queries.at(-1).sql,/date_trunc\('month',NOW\(\) AT TIME ZONE 'Europe\/Berlin'\)/);
  assert.deepEqual(s.queries.at(-1).params,["dev"]);
  assert.equal(s.queries[0].sql.includes("JOIN analysis_log"),false);
});
test("CSV exports semicolon-separated rows with BOM, quoting and injection protection",async()=>{
  const s=reset();
  s.query=()=>({rows:[{id:"1",module:'=SUM(1;2)',provider:'a"b',model:"@danger"}]});
  const res=response();
  await route("/usage/export.csv")({query:{env:"all"}},res);
  assert.ok(res.body.startsWith("\uFEFFid;created_at;env;kind;area;module"));
  assert.ok(res.body.includes(`"'=SUM(1;2)"`));
  assert.ok(res.body.includes('"a""b"'));
  assert.ok(res.body.includes(`"'@danger"`));
  for(const prefix of ["=","+","-","@","\t","\r"]) assert.ok(usage.usageCsvField(prefix+"x").startsWith(`"'`));
  assert.match(res.headers["Content-Type"],/charset=utf-8/);
});
