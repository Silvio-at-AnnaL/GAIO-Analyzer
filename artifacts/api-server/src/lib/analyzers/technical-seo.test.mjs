import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [new URL("./technical-seo.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "technical-seo-test-cheerio",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/logger$/ }, () => ({ path: "logger", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
        contents: `export const logger = {warn(){}};`,
      }));
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

function synthetic(htmls = [goodHtml()], overrides = {}) {
  return {
    ...crawl(htmls.map((_, i) => `https://www.example.de/page-${i}`)),
    pages: htmls.map((html, i) => ({
      url: `https://www.example.de/page-${i}`, html, statusCode: 200, responseTime: 400, ttfb: 100,
    })),
    httpsRedirect: "enforced", robotsTxtExists: true, robotsTxtStatus: "found",
    sitemapXmlExists: true, sitemapStatus: "found", sitemapType: "xml",
    reliability: { attempted: htmls.length, succeeded: htmls.length, failed: 0, failures: [] },
    siteLanguage: { lang: "de" }, skipped: { otherLanguage: 0 },
    ...overrides,
  };
}
function goodHtml(i = "") {
  return `<head><title>Ein guter Seitentitel ${i}</title>
    <meta name="description" content="Eine ausführliche Beschreibung mit mindestens fünfzig Zeichen für diese gute Beispielseite ${i}">
    <meta name="viewport"><link rel="canonical" href="/example"></head><body><img alt="Produkt"></body>`;
}
function result(htmls, overrides = {}, params) {
  return analyzeTechnicalSeo(synthetic(htmls, overrides), "https://www.example.de", params);
}
function component(value, key) {
  return value.breakdown.components.find(c => c.key === key);
}
test("perfect single-language site scores 100 with all 12 components and hreflang null", () => {
  const value = result();
  assert.equal(value.score, 100);
  assert.equal(value.breakdown.components.length, 12);
  assert.equal(value.breakdown.evaluatedWeight, 95);
  for (const c of value.breakdown.components) {
    assert.equal(c.fraction, c.key === "hreflang" ? null : 1, c.key);
    assert.equal(c.points, c.key === "hreflang" ? null : c.weight, c.key);
  }
});
test("HTTPS uses redirect evidence, never the input scheme; unknown is unscored", () => {
  for (const [status, fraction] of [["enforced", 1], ["not_enforced", 0], ["unknown", null]]) {
    const value = result(undefined, { httpsRedirect: status });
    assert.equal(component(value, "https").fraction, fraction);
    assert.equal(value.httpsEnforced, status === "enforced");
  }
});
test("crawl reliability uses all attempts, and zero attempts or uploads are unscored", () => {
  assert.equal(component(result(undefined, { reliability: { attempted: 4, succeeded: 3 } }), "crawl").fraction, .75);
  assert.equal(component(result(undefined, { reliability: { attempted: 0, succeeded: 0 } }), "crawl").fraction, null);
  const upload = analyzeTechnicalSeo(synthetic(), "uploaded-page");
  assert.equal(component(upload, "crawl").fraction, null);
  assert.equal(component(upload, "https").fraction, null);
  assert.equal(upload.httpsEnforced, false);
});
test("technical file errors are null, missing is zero, XML/index found is full, HTML gets profile credit", () => {
  for (const key of ["robots", "sitemap"]) {
    const field = key === "robots" ? "robotsTxtStatus" : "sitemapStatus";
    for (const [status, expected] of [["error", null], ["missing", 0], ["found", 1]]) {
      assert.equal(component(result(undefined, { [field]: status }), key).fraction, expected);
    }
  }
  assert.equal(component(result(undefined, { sitemapType: "xml_index" }), "sitemap").fraction, 1);
  assert.equal(component(result(undefined, { sitemapType: "html" }), "sitemap").fraction, .5);
  assert.equal(component(result(undefined, { sitemapType: "html" }, { html_sitemap_credit: .25 }), "sitemap").fraction, .25);
});
test("robots and googlebot noindex are case insensitive and scored per page", () => {
  const value = result([
    goodHtml() + '<meta name="ROBOTS" content="follow, NOINDEX">',
    goodHtml() + '<meta name="GoogleBot" content="noindex">',
    goodHtml() + '<meta name="robots" content="index,follow">',
  ]);
  assert.equal(component(value, "indexable").fraction, 1 / 3);
  assert.deepEqual(component(value, "indexable").detail, { noindex: 2, pages: 3 });
});
test("canonicals resolve relative URLs, ignore www, and reject other hosts, missing and invalid URLs", () => {
  const htmls = ["/target", "https://example.de/a", "https://other.de/a", "http://[bad", ""]
    .map(href => `<link rel="canonical" href="${href}">`);
  const value = result(htmls);
  assert.equal(component(value, "canonical").fraction, .4);
  assert.equal(value.canonicalTags.count, 5); // Legacy presence field retained.
});
for (const [key, tag, minKey, maxKey, defaults] of [
  ["title", value => `<title>${value}</title>`, "title_min", "title_max", [15, 75]],
  ["description", value => `<meta name="description" content="${value}">`, "desc_min", "desc_max", [50, 170]],
]) {
  test(`${key}: missing, short, long and boundaries; thresholds come from params`, () => {
    const [min, max] = defaults;
    const value = result(["", "x".repeat(min - 1), "y".repeat(max + 1), "a".repeat(min), "b".repeat(max)].map(tag));
    assert.equal(component(value, key).fraction, .6);
    assert.deepEqual(component(value, key).detail, { missing: 1, outOfRange: 2, duplicate: 0, pages: 5 });
    const legacy = value[key === "title" ? "metaTitles" : "metaDescriptions"];
    assert.equal(legacy.tooShort, 1);
    assert.equal(legacy.tooLong, 1);
    const custom = result([tag("x".repeat(min))], {}, { [minKey]: min + 1, [maxKey]: max, length_factor: .2 });
    assert.equal(component(custom, key).fraction, .2);
    assert.equal(custom.breakdown.params[minKey], min + 1);
  });
  test(`${key}: normalised duplicates multiply with length penalties on every affected page`, () => {
    const value = result([tag("  DUP \n  text "), tag("dup text")], {}, { length_factor: .4, duplicate_factor: .25 });
    assert.equal(component(value, key).fraction, .1);
    assert.deepEqual(component(value, key).detail, { missing: 0, outOfRange: 2, duplicate: 2, pages: 2 });
    const within = "Unique ".repeat(8).trim();
    assert.equal(component(result([tag(within), tag(within.toUpperCase())]), key).fraction, .5);
  });
}
test("viewport and image alt use coverage, including no-image full credit", () => {
  const value = result(['<meta name="viewport"><img alt=" A "><img alt="">', '<img>']);
  assert.equal(component(value, "viewport").fraction, .5);
  assert.equal(component(value, "alt").fraction, 1 / 3);
  assert.equal(component(result(["<p>No images</p>"]), "alt").fraction, 1);
});
test("response bands use strict boundaries and all three profile parameters", () => {
  for (const [ms, expected] of [[999, 1], [1000, .6], [1999, .6], [2000, 0]]) {
    const data = synthetic();
    data.pages[0].responseTime = ms;
    assert.equal(component(analyzeTechnicalSeo(data, "https://example.de"), "response").fraction, expected);
  }
  const data = synthetic();
  data.pages[0].responseTime = 600;
  assert.equal(component(analyzeTechnicalSeo(data, "https://example.de", {
    response_good_ms: 500, response_ok_ms: 700, response_ok_credit: .3,
  }), "response").fraction, .3);
});
test("hreflang requires evidence: skipped language alone and external or same-language links do not count", () => {
  for (const links of ["", '<a href="/sc/">SC</a><a href="/nxp/">NXP</a><a href="/mc/">MC</a><a href="/bom-tool">BOM</a><a href="/faq">FAQ</a><a href="/new">NEW</a>',
    '<a href="/de/produkte">DE</a>', '<a href="https://other.de/en/">EN</a>']) {
    assert.equal(component(result([goodHtml() + links], { skipped: { otherLanguage: 20 } }), "hreflang").fraction, null);
  }
  assert.equal(component(result([goodHtml() + '<a href="https://example.de/en/products">EN</a>']), "hreflang").fraction, 0);
  assert.equal(component(result([goodHtml() + '<a href="/en-US/products">EN</a>']), "hreflang").fraction, 0);
  // Genuine language links still count alongside ordinary Farnell-like paths.
  assert.equal(component(result([goodHtml() + '<a href="/sc/products">SC</a><a href="/nxp/products">NXP</a><a href="/en-DE/services">in English</a>']), "hreflang").fraction, 0);
});
test("hreflang coverage is proportional below 80%, full credit at 80%", () => {
  const alternate = '<link rel="alternate" hreflang="en" href="/en/">';
  for (const count of [1, 3, 4, 5]) {
    const value = result(Array.from({ length: 5 }, (_, i) => goodHtml(i) + (i < count ? alternate : "")));
    assert.equal(component(value, "hreflang").fraction, count >= 4 ? 1 : count / 5);
  }
});
test("weights normalise only evaluated components and zero evaluated weight gives score zero", () => {
  const weights = Object.fromEntries(["https", "crawl", "robots", "sitemap", "indexable", "canonical", "title", "description", "viewport", "alt", "response", "hreflang"]
    .map(key => [`weight_${key}`, 0]));
  const value = result(undefined, { httpsRedirect: "unknown", robotsTxtStatus: "missing" },
    { ...weights, weight_https: 40, weight_robots: 10, weight_title: 30, weight_hreflang: 40 });
  assert.equal(value.score, 75);
  assert.equal(value.breakdown.evaluatedWeight, 40);
  assert.equal(result(undefined, {}, weights).score, 0);
});
