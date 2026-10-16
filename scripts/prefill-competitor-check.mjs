// Real prefill route, real configured AI/search settings, SELECT-only DB connections.
// Test-only observation captures internal context without adding it to the API response.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
const root = new URL("../", import.meta.url).pathname;
const result = await build({
  stdin: {
    contents: `(async () => {
      const {default: router} = await import("./artifacts/api-server/src/routes/prefill");
      const {getSetting} = await import("./artifacts/api-server/src/lib/admin-db");
      const {pool} = await import("./artifacts/api-server/src/lib/db");
      const {setLogSink} = await import("./artifacts/api-server/src/lib/logger");
      const {writeFile} = await import("node:fs/promises");
      const initialSource = await getSetting("competitor_source");
      const cases = [
        {company_name:"Hammelmann GmbH",url:"https://www.hammelmann.com/de/"},
        {company_name:"ARNTZ",url:"https://www.arntz.de/"},
      ];
      const results = [];
      try {
        for (const body of cases) {
          const logs = [];
          setLogSink(entry => logs.push(entry));
          const response = {code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;}};
          const handler = router.stack.find(layer => layer.route?.path === "/prefill").route.stack[0].handle;
          await handler({body},response);
          const observation = globalThis.__prefillLiveObservation;
          const output = {
            request:body,configuredSource:initialSource,httpStatus:response.code,
            ...observation,response:response.body,
            queries:logs.filter(e=>e.msg==="Prefill: competitor search queries").flatMap(e=>e.obj.queries),
            verdicts:logs.filter(e=>e.msg==="Prefill: competitor relevance verdict").map(e=>e.obj),
            validations:logs.filter(e=>e.msg.startsWith("Prefill validate:")).map(e=>({msg:e.msg,...e.obj})),
          };
          results.push(output);
          console.log("PREFILL_VERIFICATION " + JSON.stringify(output));
          await writeFile("/tmp/prefill-competitor-live.json",JSON.stringify(results,null,2));
          if(response.code !== 200) throw Error("Prefill failed: "+response.code);
        }
        if(await getSetting("competitor_source") !== initialSource) throw Error("competitor_source changed");
        console.log("PREFILL_SETTING_UNCHANGED " + JSON.stringify({competitor_source:initialSource}));
      } finally {setLogSink(null); await pool.end();}
    })().catch(error=>{console.error(error.message);process.exitCode=1;});`,
    resolveDir: root, loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", write: false,
  external: ["express", "cheerio", "pg", "pino", "bcryptjs", "@anthropic-ai/sdk"],
  plugins: [{
    name: "read-only-prefill-observer",
    setup(b) {
      b.onLoad({filter:/\/lib\/db\.ts$/}, async args => {
        const source = await readFile(args.path, "utf8");
        const marker = "const pool = new pg.Pool({";
        if (!source.includes(marker)) throw Error("DB observation marker missing");
        return {contents:source.replace(marker, `${marker}\n  options: "-c default_transaction_read_only=on",`),loader:"ts"};
      });
      b.onLoad({filter:/\/routes\/prefill\.ts$/}, async args => {
        const source = await readFile(args.path, "utf8");
        const marker = "  // STEP 4 — Validate & correct competitor URLs in parallel";
        if (!source.includes(marker)) throw Error("Prefill observation marker missing");
        return {contents:source.replace(marker, `globalThis.__prefillLiveObservation = {
          company_context, content_summary, competitorContext, crawlFailed,
          initialCandidates: rawCompetitors.map(c=>({...c}))
        };\n${marker}`),loader:"ts"};
      });
    },
  }],
});
const bundlePath = "/tmp/prefill-competitor-check.cjs";
await writeFile(bundlePath, result.outputFiles[0].contents);
const child = spawnSync(process.execPath, [bundlePath], {
  cwd: root, stdio: "inherit",
  env: {...process.env, NODE_ENV:"production", NODE_PATH: [
    `${root}artifacts/api-server/node_modules`,`${root}node_modules`,
  ].join(":")},
});
process.exitCode = child.status ?? 1;
