// Generate synthetic report fixtures only; never loads a stored report or DB.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const require = createRequire(new URL("../artifacts/gaio-analyzer/package.json", import.meta.url));
const { build } = require("esbuild");
const { outputFiles } = await build({
  entryPoints: [new URL("../artifacts/gaio-analyzer/src/lib/report-export.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env.BASE_URL": '"/"' },
});
const { generateHtmlReport } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
globalThis.fetch = async () => ({ ok: false });
const report = { id: "fixture", status: "failed", url: "https://example.test", errors: [],
  errorCode: "crawl_bot_protection", crawledPages: [],
  blockedRobotsHint: { generalRule: "partial", fullyBlockedAgents: ["bingbot"], crawlers: [
    { name: "GPTBot", status: "not_mentioned" }, { name: "ClaudeBot", status: "not_mentioned" },
  ] } };
await writeFile(`/tmp/faq-failed-${process.argv[2] ?? "current"}.html`, await generateHtmlReport(report));
