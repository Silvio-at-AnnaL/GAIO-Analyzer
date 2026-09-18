import * as cheerio from "cheerio";

export function getTitleFromDom($: cheerio.CheerioAPI): string {
  const headTitle = $("head > title").first().text();
  const title = headTitle || $("title")
    .filter((_, el) => $(el).parents("svg").length === 0)
    .first()
    .text();
  return title.replace(/\s+/g, " ").trim();
}

export function getTitleFromHtml(html: string): string {
  return getTitleFromDom(cheerio.load(html));
}