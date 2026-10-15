// Crawl-only live verification. No analysis engine, database, or persistent logger.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const { outputFiles } = await build({
  stdin: {
    contents: `export { crawlSite } from "./artifacts/api-server/src/lib/crawler";
      export { describeCrawlFailure } from "./artifacts/api-server/src/lib/crawl-failure";
      export { compileExclusionRules } from "./artifacts/api-server/src/lib/crawl-exclusions";
      export { CRAWL_EXCLUSION_SEED } from "./artifacts/api-server/src/lib/crawl-exclusion-seed";
      export { robotsHintText } from "./artifacts/gaio-analyzer/src/lib/crawl-errors";`,
    resolveDir: new URL("../", import.meta.url).pathname,
  },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "crawl-only",
    setup(builder) {
      builder.onResolve({ filter: /^cheerio$/ }, () => ({ path: pathToFileURL(require.resolve("cheerio")).href, external: true }));
      builder.onResolve({ filter: /\/logger(?:\.js)?$/ }, () => ({ path: "logger", namespace: "no-db" }));
      builder.onLoad({ filter: /.*/, namespace: "no-db" }, () => ({
        contents: "export const logger = { info(){}, warn(){}, debug(){} };",
      }));
    },
  }],
});
const { crawlSite, describeCrawlFailure, compileExclusionRules, CRAWL_EXCLUSION_SEED, robotsHintText } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const url = process.argv[2] ?? "https://www.hammelmann.com/de/";
const result = await crawlSite(url, 16, {
  exclusionMatcher: compileExclusionRules(CRAWL_EXCLUSION_SEED.map(rule => ({ ...rule, is_active: true }))),
  deadlineMs: 90_000, techPhaseBudgetMs: 30_000, minPagePhaseMs: 45_000, mainSite: true,
});
const failure = result.pages.length === 0 ? describeCrawlFailure(result, false) : null;
console.log(JSON.stringify({ url, evaluatedPages: result.pages.length, homepageFailReason: result.homepageFailReason,
  robotsTxtStatus: result.robotsTxtStatus, ...failure }, null, 2));
const hint = failure && robotsHintText(failure);
if (hint) console.log([hint.title, ...hint.crawlers, hint.fullyBlocked, hint.note].filter(Boolean).join("\n"));
