import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [new URL("./crawl-failure.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "no-database",
    setup(builder) {
      builder.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
      builder.onResolve({ filter: /^\.\.\/logger$/ }, () => ({ path: "logger", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const logger = {};" }));
    },
  }],
});
const { describeCrawlFailure } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
function failure(robotsTxt, extra = {}) {
  return describeCrawlFailure({ homepageFailReason: "bot_protection", robotsTxtStatus: "found", robotsTxt, ...extra }, false);
}

test("blocked robots hint reuses the crawler list and reports wildcard allowed and bingbot blocked", () => {
  const hint = failure("User-agent: bingbot\nDisallow: /\nUser-agent: *\nDisallow:").blockedRobotsHint;
  assert.equal(hint.crawlers.length, 10);
  assert.ok(hint.crawlers.every(c => c.status === "not_mentioned"));
  assert.equal(hint.generalRule, "allowed");
  assert.deepEqual(hint.fullyBlockedAgents, ["bingbot"]);
});

test("blocked robots hint distinguishes partial wildcard restrictions and explicit GPTBot block", () => {
  const hint = failure("User-agent: GPTBot\nDisallow: /\nUser-agent: *\nDisallow:\nDisallow: /private/").blockedRobotsHint;
  assert.equal(hint.crawlers.find(c => c.name === "GPTBot").status, "disallowed");
  assert.equal(hint.generalRule, "partial");
  assert.deepEqual(hint.fullyBlockedAgents, ["GPTBot"]);
  assert.equal(failure("User-agent: *\nDisallow: /").blockedRobotsHint.generalRule, "blocked");
});

test("robots hint requires bot protection and a readable robots.txt", () => {
  for (const extra of [{ robotsTxtStatus: "missing" }, { robotsTxtStatus: "error" }, { robotsTxt: null },
    { homepageFailReason: "parked_domain" }, { homepageFailReason: "timeout", timedOut: true },
    { homepageFailReason: "dns" }]) {
    assert.equal(failure("User-agent: *\nDisallow:", extra).blockedRobotsHint, undefined);
  }
});
