import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const logs = [];
globalThis.__httpsLogs = logs;
const { outputFiles } = await build({
  entryPoints: [new URL("./crawler.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "https-test",
    setup(b) {
      b.onResolve({ filter: /^cheerio$/ }, () => ({ path: import.meta.resolve("cheerio"), external: true }));
      b.onResolve({ filter: /^\.\/logger$/ }, () => ({ path: "logger", namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: `
        export const logger = { info(){}, debug(){}, warn(obj,msg){ globalThis.__httpsLogs.push({obj,msg}); } };
      ` }));
    },
  }],
});
const { checkHttpsRedirect, fetchSiteTechFiles, crawlSite } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });

test("HTTPS redirects: real local HTTP/TLS chain, HTTP 200, timeout, five-hop limit, and tech-file integration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaio-https-"));
  let http, https;
  const originalFetch = globalThis.fetch;
  try {
    // Certificate and TLS trust exception exist only in this local test transport.
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
      "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
    let mode = "enforced";
    https = createHttpsServer({
      key: await readFile(join(dir, "key.pem")), cert: await readFile(join(dir, "cert.pem")),
    }, (req, res) => {
      if (mode === "downgrade") res.writeHead(302, { Location: `http://127.0.0.1:${http.address().port}/plain` });
      res.end("secure");
    });
    await listen(https);
    http = createServer((req, res) => {
      if (mode === "timeout" && req.url === "/") return;
      if (mode === "loop") {
        res.writeHead(302, { Location: `/hop-${Number(req.url.match(/\d+/)?.[0] ?? 0) + 1}` });
      } else if (mode === "five" || mode === "enforced" || mode === "downgrade") {
        const hop = Number(req.url.match(/\d+/)?.[0] ?? 0);
        if (req.url === "/plain") { res.end("plain"); return; }
        if (mode === "five" && hop < 4) res.writeHead(302, { Location: `/hop-${hop + 1}` });
        else res.writeHead(302, { Location: `https://127.0.0.1:${https.address().port}/secure` });
      }
      res.end("<html><head><title>Local fixture</title></head><body>Local test</body></html>");
    });
    await listen(http);
    const origin = `http://127.0.0.1:${http.address().port}`;
    globalThis.fetch = async (url, opts) => {
      if (String(url).startsWith(`https://127.0.0.1:${https.address().port}`)) {
        return new Promise((resolve, reject) => {
          const req = httpsRequest(url, {
            rejectUnauthorized: false, headers: opts?.headers, signal: opts?.signal,
          }, res => {
            res.resume();
            resolve(new Response(null, { status: res.statusCode, headers: res.headers }));
          });
          req.on("error", reject);
          req.end();
        });
      }
      return originalFetch(url, opts);
    };
    assert.equal(await checkHttpsRedirect(origin), "enforced");
    mode = "five";
    assert.equal(await checkHttpsRedirect(origin), "enforced");
    mode = "plain";
    assert.equal(await checkHttpsRedirect(origin), "not_enforced");
    mode = "downgrade";
    assert.equal(await checkHttpsRedirect(origin), "not_enforced"); // Final URL, not intermediate scheme.
    mode = "loop";
    assert.equal(await checkHttpsRedirect(origin), "unknown");
    assert.ok(logs.some(l => l.msg === "https redirect check failed" && l.obj.reason === "redirect_hop_limit"));
    mode = "timeout";
    assert.equal(await checkHttpsRedirect(origin, 30), "unknown");
    assert.ok(logs.some(l => l.msg === "https redirect check failed" && /timeout/i.test(l.obj.reason)));
    mode = "plain";
    assert.equal((await fetchSiteTechFiles(origin)).httpsRedirect, "not_enforced");
    const crawled = await crawlSite(origin, 1, {
      exclusionMatcher: { isExcluded: () => false, countsInReport: () => false },
    });
    assert.equal(crawled.httpsRedirect, "not_enforced");
  } finally {
    globalThis.fetch = originalFetch;
    if (http) await close(http);
    if (https) await close(https);
    await rm(dir, { recursive: true, force: true });
    delete globalThis.__httpsLogs;
  }
});
