import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const authSource = await readFile(new URL("../store/authStore.tsx", import.meta.url), "utf8");
const accessFunction = authSource.match(/export function canAccess\([\s\S]*?\n\}/)[0];
const mocks = {
  react: `
    export function useState(initial) {
      const h=globalThis.__usageUi,i=h.cursor++;
      if(!(i in h.slots))h.slots[i]=typeof initial==="function"?initial():initial;
      return [h.slots[i],value=>{h.slots[i]=typeof value==="function"?value(h.slots[i]):value;}];
    }
    export function useRef(current) {
      const h=globalThis.__usageUi,i=h.cursor++;
      if(!(i in h.slots))h.slots[i]={current};
      return h.slots[i];
    }
    export function useCallback(fn,deps) {
      const h=globalThis.__usageUi,i=h.cursor++;
      if(!h.deps[i]||deps.some((v,j)=>!Object.is(v,h.deps[i][j]))) {h.deps[i]=deps;h.slots[i]=fn;}
      return h.slots[i];
    }
    export function useEffect(fn,deps) {
      const h=globalThis.__usageUi,i=h.cursor++;
      if(!h.deps[i]||deps.some((v,j)=>!Object.is(v,h.deps[i][j]))) {
        h.deps[i]=deps;h.effects.push(()=>{h.cleanups[i]?.();h.cleanups[i]=fn();});
      }
    }`,
  "react/jsx-runtime": `export const Fragment="fragment";export const jsx=(type,props,key)=>({type,props:props??{},key});export const jsxs=jsx;`,
  "@/store/authStore": `
    ${accessFunction}
    export const useAuth=()=>globalThis.__usageUi.auth;
    export async function adminFetch(url,options) {
      const h=globalThis.__usageUi;h.calls.push([url,options]);
      if(options?.method==="PATCH"){
        const body=JSON.parse(options.body);
        if(h.validationError)return new Response(JSON.stringify({error:h.validationError}),{status:400});
        Object.assign(h.settings,body);
        return new Response("{}");
      }
      if(url.includes("/usage/summary")){
        if(h.usageFailure==="throw")throw new Error("network");
        if(h.usageFailure)return new Response("{}",{status:403});
        return new Response(JSON.stringify({searchMonth:h.month}));
      }
      if(url.includes("/analysis-log"))return new Response(JSON.stringify(h.log));
      if(url.endsWith("ai-status"))return new Response(JSON.stringify({provider:"claude",hasApiKey:{claude:true}}));
      return new Response(JSON.stringify(h.settings));
    }`,
  "@/store/appStore": `export const useAppStore=()=>({setActiveView(){},setSystemLogAnalysisId(){}});`,
  "@/lib/LabelProvider": `export const useT=()=>globalThis.__usageUi.t;export const useLabelContext=()=>({locale:"de"});`,
  "lucide-react": `export const Save="icon",CheckCircle="icon",AlertCircle="icon",Loader2="icon",
    Plus="icon",Trash2="icon",Pencil="icon",X="icon",Download="icon",ChevronLeft="icon",ChevronRight="icon",ScrollText="icon";`,
};
async function load(entry) {
  const {outputFiles}=await build({entryPoints:[new URL(entry,import.meta.url).pathname],
    bundle:true,platform:"node",format:"esm",jsx:"automatic",write:false,plugins:[{name:"usage-ui",setup(b){
      b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:"mock"}:undefined);
      b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:mocks[args.path],loader:"ts"}));
    }}]});
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}
const {labelDefaults}=await load("./labelDefaults.ts");
const helpers=await load("./admin-usage.ts");
const {AiToolView}=await load("../views/admin/AiToolView.tsx");
const {TavilyPlanFields,TavilyUsageLine}=await load("../views/admin/AiUsageFields.tsx");
const {AnalysisLogView}=await load("../views/admin/AnalysisLogView.tsx");
function harness(Component,props={},role="admin",permissions={}) {
  const h=globalThis.__usageUi={slots:[],deps:[],cleanups:[],effects:[],calls:[],
    auth:{user:{id:1,role},isAuthenticated:true,isLoading:false,permissions},
    settings:{ai_provider:"claude",ai_prices:JSON.stringify({claude:{inputPerMTok:3,outputPerMTok:15},other:{inputPerMTok:1,outputPerMTok:2}}),
      ai_custom_providers:JSON.stringify([{id:"custom",name:"Custom",model:"test",base_url:"https://test.invalid",enabled:true}]),
      search_plan:"free",search_included_credits:"1000",competitor_source:"ai"},
    month:{used:790,included:1000,plan:"free"},
    log:{items:[],total:0,pages:1,page:1,storageTotalKb:0},
    t:(key,params={})=>Object.entries(params).reduce((s,[k,v])=>s.replaceAll(`{${k}}`,String(v)),labelDefaults[key]?.de??key),
    render(){this.cursor=0;this.root=Component(props);return this.root;},
    async settle(){for(let i=0;i<8;i++){this.render();const effects=this.effects.splice(0);for(const effect of effects)effect();await new Promise(r=>setImmediate(r));}this.render();},
  };
  // Feedback timers should not hold the test process open.
  globalThis.window={dispatchEvent(){}};
  return h;
}
function nodes(node,predicate) {
  if(node==null||typeof node==="boolean")return [];
  if(Array.isArray(node))return node.flatMap(n=>nodes(n,predicate));
  if(typeof node!=="object")return [];
  return [...(predicate(node)?[node]:[]),...nodes(node.props?.children,predicate)];
}
const find=(h,id)=>nodes(h.root,n=>n.props?.["data-testid"]===id)[0];
const component=(h,name)=>nodes(h.root,n=>n.type?.name===name)[0];
const patches=h=>h.calls.filter(([,o])=>o?.method==="PATCH").map(([,o])=>JSON.parse(o.body));
function text(node){return node==null||typeof node==="boolean"?"":Array.isArray(node)?node.map(text).join(""):typeof node==="object"?text(node.props?.children):String(node);}

test("provider prices load the server default and retain other providers on merge-save",async()=>{
  const h=harness(AiToolView);await h.settle();
  assert.deepEqual(component(h,"ProviderPriceFields").props.value,{input:"3",output:"15"});
  component(h,"ProviderPriceFields").props.onChange({input:"4",output:"20"});h.render();
  // A provider added after the first load must also survive the fresh merge.
  h.settings.ai_prices=JSON.stringify({...JSON.parse(h.settings.ai_prices),recent:{inputPerMTok:7,outputPerMTok:8}});
  await find(h,"button-save-provider-claude").props.onClick();await h.settle();
  const prices=JSON.parse(patches(h)[0].ai_prices);
  assert.deepEqual(prices.claude,{inputPerMTok:4,outputPerMTok:20});
  assert.deepEqual(prices.other,{inputPerMTok:1,outputPerMTok:2});
  assert.deepEqual(prices.recent,{inputPerMTok:7,outputPerMTok:8});
});
test("empty provider price inputs remove only that provider entry and survive reload",async()=>{
  const h=harness(AiToolView);await h.settle();
  component(h,"ProviderPriceFields").props.onChange({input:"",output:""});h.render();
  await find(h,"button-save-provider-claude").props.onClick();await h.settle();
  assert.deepEqual(JSON.parse(patches(h)[0].ai_prices),{other:{inputPerMTok:1,outputPerMTok:2}});
  assert.deepEqual(component(h,"ProviderPriceFields").props.value,{input:"",output:""});
});
test("custom provider tabs have price inputs and merge-save without changing provider credentials",async()=>{
  const h=harness(AiToolView);await h.settle();
  nodes(h.root,n=>n.type==="button"&&text(n)==="Custom")[0].props.onClick();h.render();
  const fields=component(h,"ProviderPriceFields");
  assert.equal(fields.props.providerId,"custom");
  fields.props.onChange({input:"0.5",output:"1.5"});h.render();
  await find(h,"button-save-price-custom").props.onClick();await h.settle();
  const patch=patches(h)[0];
  assert.deepEqual(Object.keys(patch),["ai_prices"]);
  assert.deepEqual(JSON.parse(patch.ai_prices).custom,{inputPerMTok:0.5,outputPerMTok:1.5});
});
test("server validation messages appear for provider prices and Tavily settings",async()=>{
  const h=harness(AiToolView);await h.settle();
  h.validationError="Synthetic validation detail";
  component(h,"ProviderPriceFields").props.onChange({input:"-1",output:"15"});h.render();
  await find(h,"button-save-provider-claude").props.onClick();await h.settle();
  assert.ok(nodes(h.root,n=>n.props?.msg==="Synthetic validation detail").length);
  await find(h,"button-save-competitor-source").props.onClick();await h.settle();
  assert.ok(nodes(h.root,n=>n.props?.msg==="Synthetic validation detail").length);
});
for(const [plan,keys] of [
  ["free",["search_included_credits"]],["payg",["search_credit_price_usd"]],
  ["package",["search_monthly_price_usd","search_included_credits","search_credit_price_usd"]],
  ["enterprise",["search_monthly_price_usd","search_included_credits","search_credit_price_usd"]],
]) test(`${plan} shows the specified fields and saves the matching setting keys`,async()=>{
  const settings={search_plan:plan,search_included_credits:"1000",search_monthly_price_usd:"20",search_credit_price_usd:"0.01"};
  const h=harness(TavilyPlanFields,{settings,onChange(){}});h.render();
  assert.deepEqual(nodes(h.root,n=>n.type==="input").map(n=>n.props["data-testid"]),keys.map(k=>"input-"+k.replaceAll("_","-")));
  if(plan==="enterprise")assert.ok(nodes(h.root,n=>n.type==="input").every(n=>!n.props.required));
  assert.deepEqual(Object.keys(helpers.searchPlanPatch(settings)).sort(),["search_plan",...keys].sort());
  const view=harness(AiToolView);await view.settle();
  for(const [key,value] of Object.entries(settings))component(view,"TavilyPlanFields").props.onChange(key,value);
  view.render();await find(view,"button-save-competitor-source").props.onClick();await view.settle();
  for(const [key,value] of Object.entries(helpers.searchPlanPatch(settings)))assert.equal(patches(view)[0][key],value);
});
test("blank optional Enterprise fields do not send an invalid blank integer",()=>{
  assert.deepEqual(helpers.searchPlanPatch({search_plan:"enterprise",search_included_credits:""}),{
    search_plan:"enterprise",search_monthly_price_usd:"",search_credit_price_usd:"",
  });
});
for(const [used,level] of [[790,"normal"],[800,"amber"],[1000,"red"]])test(`Tavily usage at ${used/10}% has the right threshold and warning`,async()=>{
  const h=harness(TavilyUsageLine,{allowed:true,userId:1});h.month.used=used;await h.settle();
  assert.equal(find(h,"text-tavily-usage").props["data-level"],level);
  assert.ok(text(h.root).includes(`Tavily diesen Monat: ${new Intl.NumberFormat("de-DE").format(used)} / 1.000 Credits`));
  assert.equal(text(h.root).includes("Kontingent ausgeschöpft"),level==="red");
  assert.equal(h.calls[0][0],"/api/admin/usage/summary?env=live");
});
test("usage is hidden and never requested without kosten access, and hidden after failed requests",async()=>{
  let h=harness(TavilyUsageLine,{allowed:false,userId:1});await h.settle();
  assert.equal(h.root,null);assert.equal(h.calls.length,0);
  for(const failure of [true,"throw"]) {
    h=harness(TavilyUsageLine,{allowed:true,userId:1});h.usageFailure=failure;await h.settle();
    assert.equal(h.root,null);
  }
  h=harness(AiToolView,{},"user",{});await h.settle();
  assert.equal(component(h,"TavilyUsageLine").props.allowed,false);
});
const usage=()=>({currency:"USD",analysis:{calls:1,inputTokens:1234,outputTokens:5678,costUsd:0.32},
  preparation:{calls:1,inputTokens:9000,outputTokens:1000,costUsd:0.05,searchCredits:3,searchCostUsd:0.01}});
test("cost sum includes preparation once, with null/zero/tiny USD handling",()=>{
  const h=harness(()=>null);
  for(const [a,p,expected] of [[0.32,0.05,"0,37 $"],[null,0.05,"0,05 $"],[0,null,"0,00 $"],[null,null,"–"],[0.001,0,"< 0,01 $"]]){
    const u=usage();u.analysis.costUsd=a;u.preparation.costUsd=p;
    assert.equal(helpers.usageCostCell(u,h.t).text,expected);
  }
  assert.equal(helpers.usageCostCell(null,h.t).text,"–");
});
test("cost tooltip formats tokens in German and conditionally includes preparation and search prices",()=>{
  const h=harness(()=>null);const u=usage();
  assert.deepEqual(helpers.usageCostCell(u,h.t).title.split("\n"),[
    "Analyse: 0,32 $ · 1.234 / 5.678 Tokens",
    "Vorbefüllung: 0,05 $ · 9.000 / 1.000 Tokens","Websuche: 3 Credits · 0,01 $",
  ]);
  u.preparation.calls=0;u.preparation.searchCostUsd=null;
  assert.deepEqual(helpers.usageCostCell(u,h.t).title.split("\n"),[
    "Analyse: 0,32 $ · 1.234 / 5.678 Tokens","Websuche: 3 Credits",
  ]);
  u.preparation.searchCredits=0;
  assert.equal(helpers.usageCostCell(u,h.t).title.split("\n").length,1);
});
test("analysis log cost column is admin-default, explicitly delegable, hidden without kosten, and legacy-safe",async()=>{
  for(const [role,permissions,visible] of [["admin",{},true],["user",{analyseprotokoll:["user"]},false],
    ["user",{analyseprotokoll:["user"],kosten:["user"]},true]]) {
    const h=harness(AnalysisLogView,{},role,permissions);
    const item={id:1,analysisUuid:"new",domain:"https://test.invalid",status:"completed",startedAt:"2026-10-16",gaioScore:null,usage:usage()};
    h.log.items=[item,{...item,id:2,analysisUuid:"old",usage:null}];await h.settle();
    assert.equal(text(h.root).includes("Kosten"),visible);
    assert.equal(!!find(h,"text-analysis-cost-new"),visible);
    if(visible) {assert.equal(text(find(h,"text-analysis-cost-new")),"0,37 $");assert.equal(text(find(h,"text-analysis-cost-old")),"–");}
  }
});
test("all new labels exist in ai/log groups and the label count is updated",()=>{
  assert.equal(Object.keys(labelDefaults).length,1418);
  assert.equal(labelDefaults["ai.price_input"].de,"Preis Eingabe (USD je 1 Mio. Tokens)");
  assert.equal(labelDefaults["log.cost_tiny"].de,"< 0,01 $");
});
