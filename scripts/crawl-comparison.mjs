// Crawl-only verification: no analysis engine, database, or persistent log sink.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const events = [];
globalThis.__crawlComparisonEvents = events;
const bundle = await build({
  stdin: {
    contents: `export { crawlSite } from "./crawler";
      export { compileExclusionRules } from "./crawl-exclusions";
      export { CRAWL_EXCLUSION_SEED } from "./crawl-exclusion-seed";`,
    resolveDir: new URL("../artifacts/api-server/src/lib/", import.meta.url).pathname,
  },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "crawl-only",
    setup(builder) {
      builder.onResolve({ filter: /^cheerio$/ }, () => ({ path: pathToFileURL(require.resolve("cheerio")).href, external: true }));
      builder.onResolve({ filter: /^\.\/logger(?:\.js)?$/ }, () => ({ path: "logger", namespace: "crawl-only" }));
      builder.onLoad({ filter: /.*/, namespace: "crawl-only" }, () => ({
        contents: `export const logger = Object.fromEntries(["info", "warn", "debug"].map(level =>
          [level, (obj, msg) => globalThis.__crawlComparisonEvents.push({level, obj, msg})]));`,
      }));
    },
  }],
});
const { crawlSite, compileExclusionRules, CRAWL_EXCLUSION_SEED } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);
const exclusionMatcher = compileExclusionRules([
  ...CRAWL_EXCLUSION_SEED,
].map(rule => ({ ...rule, is_active: true })));
const [output, mode, ...urls] = process.argv.slice(2);
if (!output || !["baseline", "current"].includes(mode) || !urls.length) {
  throw new Error("Usage: node scripts/crawl-comparison.mjs /tmp/output.json baseline|current URL...");
}
const results = [];
for (const url of urls) {
  events.length = 0;
  const started = Date.now();
  const result = await crawlSite(url, 16, {
    exclusionMatcher, deadlineMs: 90_000,
    techPhaseBudgetMs: 30_000, minPagePhaseMs: 45_000, mainSite: true,
  });
  const failuresByStatus = {};
  const failuresByReason = {};
  for (const failure of result.reliability.failures) {
    const key = failure.statusCode ?? failure.reason;
    failuresByStatus[key] = (failuresByStatus[key] ?? 0) + 1;
    failuresByReason[failure.reason] = (failuresByReason[failure.reason] ?? 0) + 1;
  }
  results.push({
    url, pages: result.pages.map(page => page.url), ...result.reliability,
    duplicates: result.skipped.duplicate,
    droppedCategories: events.filter(event => event.msg === "category skipped: redirects to known page").map(event => event.obj),
    transientErrors: result.reliability.transientErrors ?? 0,
    recoveredAfterRetry: result.reliability.recoveredAfterRetry ?? 0,
    failuresByStatus, failuresByReason,
    unsampledFailures: result.reliability.failed - result.reliability.failures.length,
    breakerFired: events.some(event => event.msg === "retry budget exhausted"),
    retriesTotal: events.filter(event => event.msg === "Retrying page fetch").length,
    timedOut: result.timedOut, techPhaseMs: result.techPhaseMs, pagePhaseMs: result.pagePhaseMs,
    totalMs: Date.now() - started,
  });
  await writeFile(output, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}
