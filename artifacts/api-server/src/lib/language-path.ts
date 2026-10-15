// One curated definition for crawl priority, categories, filtering and SEO evidence.
export const WEB_LANGUAGE_CODES = "de en fr it es pt nl pl cs sk hu ro bg hr sl sr ru uk tr el sv da no nb nn fi et lv lt ja zh ko ar he hi th vi id ms".split(" ");
export const LANG_PREFIX_RE = new RegExp(`^/((?:${WEB_LANGUAGE_CODES.join("|")})(?:-[a-z]{2})?)(?:/|$)`, "i");

export function getPathLanguage(pathname: string): string | null {
  return pathname.match(LANG_PREFIX_RE)?.[1].toLowerCase().split("-")[0] ?? null;
}
