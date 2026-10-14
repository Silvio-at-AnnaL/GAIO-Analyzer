import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: `export * from "./crawl-exclusions.ts"; export * from "./crawl-exclusion-seed.ts";`,
    resolveDir: new URL(".", import.meta.url).pathname, loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { compileExclusionRules, CRAWL_EXCLUSION_SEED, seedCrawlExclusionRules, normalizeExclusionPattern } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
const active = entries => entries.map(rule => ({ ...rule, is_active: true }));
const seedMatcher = compileExclusionRules(active(CRAWL_EXCLUSION_SEED));
const rule = (pattern, count_in_report = true) => ({ pattern, is_active: true, count_in_report });
const decision = url => ({ excluded: seedMatcher.isExcluded(url), counted: seedMatcher.countsInReport(url) });

// Frozen legacy rules: never change these when changing the production matcher.
const OLD_KEYWORD = /login|logout|cart|warenkorb|checkout|impressum|datenschutz|privacy|cookie|agb|terms|sitemap|feed|rss|wp-admin|wp-json|partials?|ajax|sendfriend|registrieren|register|signup|anmelden|passwort-vergessen|password-reset|lostpassword|kuendigung|kündigung|mein-konto|my-account|customer\/account|merkliste|wishlist|newsletter|suche|search|reviews?_write|review-write|bewertung-schreiben|gaestebuch|guestbook|print\.php|druckansicht|printview|[?&]print=/i;
const OLD_PATH = /(?:^|\/)(?:imprint|disclaimer|legal-notice|legal-information|data-protection|data-privacy|account|widgets?)(?:\/|$)/i;
const OLD_QUERY = /^(?:eID|add-to-cart|add_to_cart|add-to-quote|add-to-wishlist|fwp_.*)$/i;
const OLD_EXTENSION = /\.(pdf|jpg|jpeg|png|gif|svg|mp4|zip|css|js)(\?|$)/i;
const OLD_TRACKING = /[?&](utm_|fbclid|gclid)/i;

function oldDecision(url) {
  const parsed = new URL(url);
  const counted = OLD_KEYWORD.test(url) || OLD_PATH.test(parsed.pathname) ||
    [...parsed.searchParams.keys()].some(key => OLD_QUERY.test(key));
  return { excluded: counted || OLD_EXTENSION.test(url) || OLD_TRACKING.test(url), counted };
}
const differs = (a, b) => a.excluded !== b.excluded || a.counted !== b.counted;
const formerPath = "imprint disclaimer legal-notice legal-information data-protection data-privacy account widget widgets".split(" ");
const formerQuery = ["print", "eid", "add-to-cart", "add_to_cart", "add-to-quote", "add-to-wishlist"];
const newShop = CRAWL_EXCLUSION_SEED.filter(entry => entry.note.startsWith("Neu:"));
const shopMatcher = compileExclusionRules(active(newShop));
const broadMatcher = compileExclusionRules(active(CRAWL_EXCLUSION_SEED.filter(entry =>
  !entry.count_in_report)));

function decodedComponents(url) {
  const parsed = new URL(url);
  const path = parsed.pathname.split("/").map(part => {
    try { return decodeURIComponent(part).normalize("NFC").toLowerCase(); } catch { return part.toLowerCase(); }
  }).filter(Boolean);
  const names = [...parsed.searchParams.keys()].map(value => value.normalize("NFC").toLowerCase());
  const values = [...parsed.searchParams.values()].flatMap(value => [value, ...value.split("/")])
    .filter(Boolean).map(value => value.normalize("NFC").toLowerCase());
  return { path, names, values };
}

// A specific predicate for each approved deviation, never a general "new
// matcher differs" escape hatch. The corpus also asserts every class is used.
function differenceClass(url) {
  const parsed = new URL(url);
  const before = oldDecision(url), after = decision(url);
  if (!differs(before, after)) return null;
  const noHost = new URL(url); noHost.hostname = "neutral.example.test";
  if (OLD_KEYWORD.test(parsed.hostname) && !differs(oldDecision(noHost.href), decision(noHost.href))) return "i";
  const c = decodedComponents(url);
  if (before.excluded && !after.excluded && /customer\/account/i.test(url)) return "ii";
  if (/%(?:c3%bc|cc%88)/i.test(url) && c.path.concat(c.names, c.values).some(value => value.includes("kündigung"))) return "iii";
  if (after.counted && !before.counted && c.path.some(value => value === "print" || value === "eid")) return "iv";
  if (after.counted && !before.counted && shopMatcher.countsInReport(url)) return "v";
  const extraComponentMatch = c.names.concat(c.values).some(value => formerPath.includes(value)) ||
    c.path.concat(c.values).some(value => formerQuery.includes(value) || value.startsWith("fwp_")) ||
    c.values.includes("print");
  if (after.counted && !before.counted && extraComponentMatch) return "vi";
  if (after.excluded && !before.excluded && !after.counted && broadMatcher.isExcluded(url)) return "vii";
  if (parsed.hash) {
    const noFragment = new URL(url); noFragment.hash = "";
    if (!differs(oldDecision(noFragment.href), decision(noFragment.href))) return "viii";
  }
  assert.fail(`Unclassified equivalence difference: ${url}\nold=${JSON.stringify(before)} new=${JSON.stringify(after)}`);
}

test("wildcard matching is whole-component exact, prefix, suffix or contains", () => {
  for (const [pattern, positive, negative] of [
    ["cart", "cart", "cartridge"], ["cart*", "cartridge", "shopping-cart"],
    ["*cart", "shopping-cart", "cartridge"], ["*cart*", "cartridge", "content"],
  ]) {
    const matcher = compileExclusionRules([rule(pattern)]);
    assert.equal(matcher.isExcluded(`https://example.test/${positive}`), true);
    assert.equal(matcher.isExcluded(`https://example.test/${negative}`), false);
  }
  const literal = compileExclusionRules([rule("a.b+[x]?")]);
  assert.equal(literal.isExcluded("https://example.test/?q=a.b%2B%5Bx%5D%3F"), true);
  assert.equal(literal.isExcluded("https://example.test/axbxxx"), false);
});

test("components decode umlauts and normalize NFC and case", () => {
  const matcher = compileExclusionRules([rule("*KÜNDIGUNG*")]);
  for (const url of [
    "https://example.test/k%C3%BCndigung", "https://example.test/KU%CC%88NDIGUNG",
    "https://example.test/?K%C3%BCNDIGUNG=yes", "https://example.test/?q=K%C3%BCNDIGUNG",
  ]) assert.equal(matcher.isExcluded(url), true);
  assert.equal(normalizeExclusionPattern("  KU\u0308NDIGUNG  "), "kündigung");
});

test("query names, values and slash-separated values are matched independently", () => {
  const matcher = compileExclusionRules([rule("account")]);
  for (const url of [
    "https://example.test/?account=yes", "https://example.test/?q=account",
    "https://example.test/?q=customer%2Faccount",
  ]) assert.equal(matcher.isExcluded(url), true);
  assert.equal(matcher.isExcluded("https://example.test/?q=accountX"), false);
});

test("hostname, scheme, port, fragments and empty components are ignored", () => {
  const matcher = compileExclusionRules([rule("*login*"), rule("")]);
  assert.equal(matcher.isExcluded("https://login.example.test:443/products#login"), false);
  assert.equal(matcher.isExcluded("https://example.test/?empty="), false);
});

test("inactive rules do not exclude, and any counted active match wins over silent matches", () => {
  const matcher = compileExclusionRules([
    { ...rule("*cart*"), is_active: false }, rule("*.pdf", false), rule("account"),
  ]);
  assert.equal(matcher.isExcluded("https://example.test/cart"), false);
  assert.equal(matcher.isExcluded("https://example.test/file.pdf"), true);
  assert.equal(matcher.countsInReport("https://example.test/file.pdf"), false);
  assert.equal(matcher.countsInReport("https://example.test/account/file.pdf"), true);
});

test("malformed percent escapes fall back to the raw segment", () => {
  const matcher = compileExclusionRules([rule("bad%zz")]);
  assert.equal(matcher.isExcluded("https://example.test/bad%zz"), true);
});

test("class vi regression: former path-only account now matches a query value", () => {
  const url = "https://example.test/?next=account";
  assert.deepEqual(oldDecision(url), { excluded: false, counted: false });
  assert.deepEqual(decision(url), { excluded: true, counted: true });
  assert.equal(differenceClass(url), "vi");
});

test("class vii regression: tracking pattern now matches a path component", () => {
  const url = "https://example.test/utm_source";
  assert.deepEqual(oldDecision(url), { excluded: false, counted: false });
  assert.deepEqual(decision(url), { excluded: true, counted: false });
  assert.equal(differenceClass(url), "vii");
});

test("class vii regression: file extension matches a non-final path component", () => {
  const url = "https://example.test/file.pdf/details";
  assert.deepEqual(oldDecision(url), { excluded: false, counted: false });
  assert.deepEqual(decision(url), { excluded: true, counted: false });
  assert.equal(differenceClass(url), "vii");
});

test("class viii regression: login in fragment is ignored", () => {
  const url = "https://example.test/products#login";
  assert.deepEqual(oldDecision(url), { excluded: true, counted: true });
  assert.deepEqual(decision(url), { excluded: false, counted: false });
  assert.equal(differenceClass(url), "viii");
});

test("seed matcher equivalence corpus classifies all and only approved differences", () => {
  const corpus = new Set();
  const add = url => corpus.add(url);
  const hosts = ["thumm-online.de", "rotima.ch", "pamas.de", "vaupel-info.de", "draht-mayr.de", "de.farnell.com"];
  for (const host of hosts) for (const path of [
    "/", "/produkte", "/unternehmen", "/anwendungen", "/technik", "/kontakt",
    "/feedback", "/research", "/cartridges", "/besuchen", "/produkte?series=industrial",
  ]) add(`https://${host}${path}`);
  for (const entry of CRAWL_EXCLUSION_SEED) {
    const component = entry.pattern.replaceAll("*", "") + (entry.pattern.endsWith("_*") ? "source" : "");
    if (component.startsWith(".")) {
      for (const path of [`/file${component}`, `/file${component}/details`, `/?file=file${component}`]) add(`https://example.test${path}`);
    } else {
      add(`https://example.test/${component}`);
      add(`https://example.test/?${encodeURIComponent(component)}=ok`);
      add(`https://example.test/?next=${encodeURIComponent(component)}`);
    }
  }
  for (const keyword of ["partials", "customer/account", "customer/accountX", "customer/accountXYZ"]) {
    add(`https://example.test/${keyword}`);
    add(`https://example.test/?${keyword}=ok`);
    add(`https://example.test/?next=${keyword}`);
  }
  for (const url of [
    "https://login.example.test/products", "https://search.example.test/content",
    "https://example.test/k%C3%BCndigung", "https://example.test/KU%CC%88NDIGUNG",
    "https://example.test/?next=account", "https://example.test/utm_source",
    "https://example.test/file.pdf/details", "https://example.test/products#login",
    "https://example.test/products#cart", "https://example.test/product.pdf#details",
    "https://example.test/?next=customer%2Faccount",
  ]) add(url);
  assert.ok(corpus.size >= 150);
  const counts = Object.fromEntries(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"].map(key => [key, 0]));
  let identical = 0;
  for (const url of corpus) {
    const cls = differenceClass(url);
    if (cls) counts[cls]++; else identical++;
  }
  for (const [cls, count] of Object.entries(counts)) assert.ok(count > 0, `Class ${cls} must be exercised`);
  console.log("Crawl exclusion equivalence corpus:", JSON.stringify({ total: corpus.size, identical, differences: counts }));
});

test("seed patterns are unique, normalized, and have the specified flags and German origins", () => {
  assert.equal(new Set(CRAWL_EXCLUSION_SEED.map(entry => entry.pattern)).size, CRAWL_EXCLUSION_SEED.length);
  for (const entry of CRAWL_EXCLUSION_SEED) {
    assert.equal(entry.pattern, normalizeExclusionPattern(entry.pattern));
    assert.ok(entry.note.startsWith("Bisherige Liste") || entry.note === "Neu: Shop-Kasse / Shop-Infoseite");
  }
  assert.equal(CRAWL_EXCLUSION_SEED.filter(entry => !entry.count_in_report).length, 13);
  assert.equal(newShop.length, 10);
  console.log("Crawl exclusion seed count:", CRAWL_EXCLUSION_SEED.length);
});

test("seeding sets the flag once; second start and deleted rows never re-seed", async () => {
  const rows = new Map(), settings = new Map();
  let inserts = 0;
  const client = { async query(sql, params) {
    if (sql.startsWith("SELECT pg_advisory")) return { rows: [] };
    if (sql.startsWith("SELECT value")) return { rows: settings.has(params[0]) ? [{ value: settings.get(params[0]) }] : [] };
    if (sql.startsWith("INSERT INTO crawl_exclusion_rules")) {
      inserts++;
      if (!rows.has(params[0])) rows.set(params[0], { counted: params[1], note: params[2] });
    } else if (sql.startsWith("INSERT INTO settings")) settings.set(params[0], params[1]);
    else assert.fail(`Unexpected seed query: ${sql}`);
    return { rows: [] };
  } };
  await seedCrawlExclusionRules(client);
  assert.equal(rows.size, CRAWL_EXCLUSION_SEED.length);
  assert.equal(settings.get("crawl_exclusions_seeded"), "1");
  await seedCrawlExclusionRules(client);
  assert.equal(inserts, CRAWL_EXCLUSION_SEED.length);
  rows.delete("*login*");
  await seedCrawlExclusionRules(client);
  assert.equal(rows.has("*login*"), false);
  assert.equal(inserts, CRAWL_EXCLUSION_SEED.length);
});

test("seed failures never set the flag, and initialization runs the step in one transaction", async () => {
  const calls = [];
  await assert.rejects(seedCrawlExclusionRules({ async query(sql) {
    calls.push(sql);
    if (sql.startsWith("INSERT INTO crawl_exclusion_rules")) throw new Error("synthetic insert failure");
    return { rows: [] };
  } }), /synthetic insert failure/);
  assert.ok(!calls.some(sql => sql.startsWith("INSERT INTO settings")));
  const source = await readFile(new URL("./admin-db.ts", import.meta.url), "utf8");
  assert.match(source, /await withTransaction\(seedCrawlExclusionRules\)/);
});
