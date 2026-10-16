import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import pino from "pino";

const lines = [];
globalThis.__correlationPino = options => pino(
  { ...options, transport: undefined },
  { write: line => lines.push(JSON.parse(line)) },
);
const { outputFiles } = await build({
  stdin: {
    contents: 'export * from "./log-context.ts"; export {logger, setLogSink} from "./logger.ts";',
    resolveDir: new URL(".", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "capture-real-pino",
    setup(b) {
      b.onResolve({ filter: /^pino$/ }, () => ({ path: "pino", namespace: "capture" }));
      b.onLoad({ filter: /.*/, namespace: "capture" }, () => ({
        contents: "export default options => globalThis.__correlationPino(options);",
      }));
    },
  }],
});
const { runWithLogContext, runWithAnalysisContext, getAnalysisId, getPrepId, parsePrepId, logger, setLogSink } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);

test("real logger lines and sink carry prepId, merge nested IDs, and do not leak context", async () => {
  lines.length = 0;
  const entries = [];
  setLogSink(entry => entries.push(entry));
  await runWithLogContext({ prepId: "prep" }, async () => {
    logger.info("prep");
    await runWithAnalysisContext("analysis", async () => {
      await Promise.resolve();
      logger.warn("both");
      assert.equal(getPrepId(), "prep");
    });
    assert.equal(getAnalysisId(), undefined);
  });
  logger.info("outside");
  for (const stream of [lines, entries.map(entry => entry.obj)]) {
    assert.equal(stream[0].prepId, "prep");
    assert.equal(stream[0].analysisId, undefined);
    assert.equal(stream[1].prepId, "prep");
    assert.equal(stream[1].analysisId, "analysis");
    assert.equal(stream[2].prepId, undefined);
    assert.equal(stream[2].analysisId, undefined);
  }
  setLogSink(null);
});

test("parallel asynchronous requests retain their own correlation IDs", async () => {
  const result = await Promise.all(["first", "second"].map(prepId =>
    runWithLogContext({ prepId }, async () => {
      await new Promise(resolve => setImmediate(resolve));
      return getPrepId();
    })));
  assert.deepEqual(result, ["first", "second"]);
  assert.equal(getPrepId(), undefined);
});

test("preparation IDs accept UUID versions and uppercase, and silently discard invalid values", () => {
  for (const version of ["0", "1", "4", "6", "7", "8", "f"]) {
    const id = `ABCDEFAB-1234-${version}BCD-ABCD-ABCDEFABCDEF`;
    assert.equal(parsePrepId(id), id.toLowerCase());
  }
  for (const value of [undefined, null, 42, {}, [], "not-a-uuid", " abcdefab-1234-4bcd-abcd-abcdefabcdef"]) {
    assert.equal(parsePrepId(value), undefined);
  }
});
