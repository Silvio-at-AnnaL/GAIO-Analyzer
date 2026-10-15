// Crawl once, compare both extractors against the exact same pages. No DB/LLM calls.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const root = new URL("../", import.meta.url).pathname;
const baselineRef = process.argv[2] ?? "HEAD";
const baselineSource = execFileSync("git", ["show", `${baselineRef}:artifacts/api-server/src/lib/analyzers/faq.ts`], { cwd: root, encoding: "utf8" });
async function load(baseline = false) {
  const { outputFiles } = await build({
    stdin: {
      contents: `export { crawlSite } from "./artifacts/api-server/src/lib/crawler";
        export { extractFaqPairs } from "./artifacts/api-server/src/lib/analyzers/faq";
        export { compileExclusionRules } from "./artifacts/api-server/src/lib/crawl-exclusions";
        export { CRAWL_EXCLUSION_SEED } from "./artifacts/api-server/src/lib/crawl-exclusion-seed";`,
      resolveDir: root,
    },
    bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{
      name: "extract-only",
      setup(builder) {
        builder.onResolve({ filter: /^cheerio$/ }, () => ({ path: pathToFileURL(require.resolve("cheerio")).href, external: true }));
        builder.onResolve({ filter: /\/(?:logger|ai-client|prompt-manager)(?:\.js)?$/ }, () => ({ path: "no-services", namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: `export const logger = {info(){},warn(){},debug(){}};
            export function callLLM(){throw Error("LLM forbidden in crawl-only check");}
            export function getPrompt(){throw Error("DB forbidden in crawl-only check");}
            export function fillTemplate(){throw Error("not used");}`,
        }));
        if (baseline) builder.onLoad({ filter: /\/analyzers\/faq\.ts$/ }, args => ({
          contents: baselineSource, loader: "ts", resolveDir: args.path.slice(0, args.path.lastIndexOf("/")),
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}
const before = await load(true);
const after = await load();
const urls = process.argv.slice(3);
if (!urls.length) urls.push("https://www.arntz.de/faq/", "https://www.vaupel.de/", "https://www.thumm.de/", "https://www.rotima.ch/", "https://www.draht-mayr.de/");
const results = await Promise.all(urls.map(async url => {
  const crawl = await after.crawlSite(url, 16, {
    exclusionMatcher: after.compileExclusionRules(after.CRAWL_EXCLUSION_SEED.map(rule => ({ ...rule, is_active: true }))),
    deadlineMs: 90_000, techPhaseBudgetMs: 30_000, minPagePhaseMs: 45_000, mainSite: true,
  });
  const oldPairs = before.extractFaqPairs(crawl.pages).visible;
  const newPairs = after.extractFaqPairs(crawl.pages).visible;
  const key = q => q.replace(/\s+/g, " ").trim().toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+$/gu, "");
  const oldKeys = new Set(oldPairs.map(pair => key(pair.question)));
  const result = {
    url, pages: crawl.pages.map(page => page.url), homepageFailReason: crawl.homepageFailReason,
    before: oldPairs.length, visiblePairCount: newPairs.length,
    firstFive: newPairs.slice(0, 5).map(pair => ({ question: pair.question, answerLength: pair.answer.length })),
    newPairs: newPairs.filter(pair => !oldKeys.has(key(pair.question))).map(pair => ({
      question: pair.question, answerStart: pair.answer.slice(0, 80),
    })),
    pairs: newPairs,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}));
await writeFile("/tmp/faq-crawl-check.json", JSON.stringify(results, null, 2));
