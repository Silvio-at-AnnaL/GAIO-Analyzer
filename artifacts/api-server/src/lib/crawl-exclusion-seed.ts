import { normalizeExclusionPattern } from "./crawl-exclusions.js";

const groups = [
  {
    patterns: "login logout cart warenkorb checkout impressum datenschutz privacy cookie agb terms sitemap feed rss wp-admin wp-json partial ajax sendfriend registrieren register signup anmelden passwort-vergessen password-reset lostpassword kuendigung kündigung mein-konto my-account merkliste wishlist newsletter suche search review_write reviews_write review-write bewertung-schreiben gaestebuch guestbook print.php druckansicht printview".split(" ").map(word => `*${word}*`),
    count_in_report: true, note: "Bisherige Liste (Schlüsselwort)",
  },
  { patterns: ["print"], count_in_report: true, note: "Bisherige Liste (Schlüsselwort)" },
  {
    patterns: "imprint disclaimer legal-notice legal-information data-protection data-privacy account widget widgets".split(" "),
    count_in_report: true, note: "Bisherige Liste (Pfadsegment)",
  },
  {
    patterns: "eid add-to-cart add_to_cart add-to-quote add-to-wishlist fwp_*".split(" "),
    count_in_report: true, note: "Bisherige Liste (Parameter)",
  },
  {
    patterns: "*.pdf *.jpg *.jpeg *.png *.gif *.svg *.mp4 *.zip *.css *.js".split(" "),
    count_in_report: false, note: "Bisherige Liste (Dateiendung)",
  },
  {
    patterns: "utm_* fbclid* gclid*".split(" "),
    count_in_report: false, note: "Bisherige Liste (Tracking)",
  },
  {
    patterns: "kasse versand versandarten versandkosten zahlung zahlungsarten zahlungsmethoden lieferbedingungen shipping payment".split(" "),
    count_in_report: true, note: "Neu: Shop-Kasse / Shop-Infoseite",
  },
];

export const CRAWL_EXCLUSION_SEED = [...new Map(groups.flatMap(group =>
  group.patterns.map(value => {
    const pattern = normalizeExclusionPattern(value);
    return [pattern, { pattern, count_in_report: group.count_in_report, note: group.note }] as const;
  }),
)).values()];

interface SeedClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// The caller runs this entire step in withTransaction. The lock prevents two
// simultaneous starts from seeding independently before either flag is visible.
export async function seedCrawlExclusionRules(client: SeedClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('crawl_exclusions_seeded'))");
  const flag = await client.query("SELECT value FROM settings WHERE key = $1", ["crawl_exclusions_seeded"]);
  if (flag.rows.length > 0) return;
  for (const rule of CRAWL_EXCLUSION_SEED) {
    await client.query(
      "INSERT INTO crawl_exclusion_rules (pattern, count_in_report, note) VALUES ($1, $2, $3) ON CONFLICT (pattern) DO NOTHING",
      [rule.pattern, rule.count_in_report, rule.note],
    );
  }
  await client.query("INSERT INTO settings (key, value) VALUES ($1, $2)", ["crawl_exclusions_seeded", "1"]);
}
