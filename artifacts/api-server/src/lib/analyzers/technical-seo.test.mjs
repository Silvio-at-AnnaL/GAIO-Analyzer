import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [new URL("./technical-seo.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "technical-seo-test-cheerio",
    setup(builder) {
      builder.onResolve({ filter: /^cheerio$/ }, () => ({
        path: import.meta.resolve("cheerio"), external: true,
      }));
    },
  }],
});
const { coverageKey, analyzeTechnicalSeo } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

function crawl(pages, sitemap = {}) {
  return {
    pages: pages.map(url => ({
      url, html: "<html><head><title>Synthetic page</title></head><body></body></html>",
      statusCode: 200, responseTime: 100, ttfb: 50, contentType: "text/html",
    })),
    robotsTxt: null, robotsTxtExists: false,
    llmsTxt: null, llmsTxtExists: false,
    sitemapXml: null, sitemapXmlExists: false, sitemapType: "none",
    htmlSitemapHtml: null, htmlSitemapUrl: null,
    ...sitemap,
  };
}

function xmlCoverage(sitemapUrls, crawledPages) {
  const result = analyzeTechnicalSeo(crawl(crawledPages, {
    sitemapType: "xml", sitemapXmlExists: true,
    sitemapXml: `<urlset>${sitemapUrls.map(url => `<url><loc>${url}</loc></url>`).join("")}</urlset>`,
  }), "https://www.example.de");
  return result.sitemapXmlAnalysis.crawledPageCoverage;
}

function htmlCoverage(links, crawledPages) {
  const result = analyzeTechnicalSeo(crawl(crawledPages, {
    sitemapType: "html", htmlSitemapUrl: "https://example.de/sitemap",
    htmlSitemapHtml: `<html><body><h1>Synthetic sitemap</h1>${links.map(href => `<a href="${href}">Page</a>`).join("")}</body></html>`,
  }), "https://www.example.de");
  return result.sitemapXmlAnalysis.crawledPageCoverage;
}

test("XML coverage matches sitemap without www against crawled pages with www", () => {
  assert.equal(xmlCoverage(["https://example.de/a"], ["https://www.example.de/a"]), 100);
});

test("XML coverage ignores http versus https", () => {
  assert.equal(xmlCoverage(["http://example.de/a"], ["https://example.de/a"]), 100);
});

test("XML coverage matches trailing slash differences including root", () => {
  assert.equal(xmlCoverage(
    ["https://example.de/a/", "https://example.de", "https://example.de/b"],
    ["https://example.de/a", "https://www.example.de/", "https://example.de/b/"],
  ), 100);
});

test("XML coverage does not match different paths", () => {
  assert.equal(xmlCoverage(["https://example.de/a"], ["https://www.example.de/b"]), 0);
});

test("XML coverage does not match different queries", () => {
  assert.equal(xmlCoverage(["https://example.de/a?item=1"], ["https://www.example.de/a?item=2"]), 0);
});

test("XML coverage does not match different registrable hosts", () => {
  assert.equal(xmlCoverage(["https://other.de/a"], ["https://www.example.de/a"]), 0);
});

test("HTML coverage matches relative and absolute non-www links against www pages", () => {
  assert.equal(htmlCoverage(
    ["/a", "b/", "http://example.de/c", "https://example.de/d/?item=1#details"],
    ["https://www.example.de/a/", "https://www.example.de/b", "https://www.example.de/c", "https://www.example.de/d?item=1"],
  ), 100);
});

test("HTML coverage still distinguishes paths, queries and hosts", () => {
  assert.equal(htmlCoverage(
    ["/a", "https://example.de/b?item=1", "https://other.de/c"],
    ["https://www.example.de/d", "https://www.example.de/b?item=2", "https://www.example.de/c"],
  ), 0);
});

test("coverage key ignores scheme, default ports and fragments while retaining whole-key lowercasing", () => {
  assert.equal(coverageKey("HTTP://WWW.EXAMPLE.DE:80/A/?Item=ONE#details"), "example.de/a?item=one");
  assert.equal(coverageKey("https://example.de:443/a?item=one#other"), "example.de/a?item=one");
});

test("coverage key strips only one leading www and preserves other subdomains", () => {
  assert.equal(coverageKey("https://www.www.example.de/a"), "www.example.de/a");
  assert.notEqual(coverageKey("https://shop.example.de/a"), coverageKey("https://example.de/a"));
});

test("coverage key keeps query content and order except for existing lowercasing", () => {
  assert.equal(coverageKey("https://example.de/A/?B=Two&A=%2F"), "example.de/a?b=two&a=%2f");
  assert.notEqual(coverageKey("https://example.de/a?b=2&a=1"), coverageKey("https://example.de/a?a=1&b=2"));
});

test("unparseable coverage URLs retain the previous lowercase and trailing-slash fallback", () => {
  assert.equal(coverageKey("NOT A URL/"), "not a url");
  assert.equal(coverageKey("/Relative/Path/"), "/relative/path");
});
