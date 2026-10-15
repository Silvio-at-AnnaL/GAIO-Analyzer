// Real crawl only; report generation has no database or AI dependency.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const {build} = require("esbuild");
const {outputFiles} = await build({
  stdin:{contents:`export {crawlSite} from "./artifacts/api-server/src/lib/crawler";
    export {describeCrawlFailure} from "./artifacts/api-server/src/lib/crawl-failure";
    export {compileExclusionRules} from "./artifacts/api-server/src/lib/crawl-exclusions";
    export {CRAWL_EXCLUSION_SEED} from "./artifacts/api-server/src/lib/crawl-exclusion-seed";
    export {generateHtmlReport} from "./artifacts/gaio-analyzer/src/lib/report-export";`,
    resolveDir:new URL("../",import.meta.url).pathname},
  bundle:true,platform:"node",format:"esm",write:false,
  define:{"import.meta.env.BASE_URL":'"/"'},
  plugins:[{name:"crawl-only",setup(b){
    b.onResolve({filter:/^cheerio$/},()=>({path:pathToFileURL(require.resolve("cheerio")).href,external:true}));
    b.onResolve({filter:/\/logger(?:\.js)?$/},()=>({path:"logger",namespace:"mock"}));
    b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export const logger={info(){},warn(){},debug(){}};"}));
  }}],
});
const {crawlSite,describeCrawlFailure,compileExclusionRules,CRAWL_EXCLUSION_SEED,generateHtmlReport}=await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const url="https://www.hammelmann.com/de/";
const crawl=await crawlSite(url,16,{
  exclusionMatcher:compileExclusionRules(CRAWL_EXCLUSION_SEED.map(r=>({...r,is_active:true}))),
  deadlineMs:90_000,techPhaseBudgetMs:30_000,minPagePhaseMs:45_000,mainSite:true,
});
if(crawl.pages.length) throw Error("Expected failed crawl; refusing to synthesize a failure.");
const failure=describeCrawlFailure(crawl,false);
const report={id:"crawl-only",status:"failed",url,...failure,errors:[failure.message],crawledPages:[],
  crawlReliability:crawl.reliability,crawlSkipped:crawl.skipped};
await writeFile("/tmp/failed-report-hammelmann.json",JSON.stringify(report,null,2));
// No branding fetches or database calls during local rendering.
globalThis.fetch=async()=>({ok:false});
await writeFile("/tmp/failed-report-hammelmann.html",await generateHtmlReport(report));
console.log(JSON.stringify({url,errorCode:failure.errorCode,evaluatedPages:0,reliability:crawl.reliability},null,2));
