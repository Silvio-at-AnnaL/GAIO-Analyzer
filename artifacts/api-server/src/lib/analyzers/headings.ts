import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";

interface HeadingItem {
  level: string;
  text: string;
}

interface PageHeadingResult {
  url: string;
  h1Count: number;
  hasHierarchyIssues: boolean;
  headings: HeadingItem[];
}

export interface HeadingResult {
  score: number;
  pages: PageHeadingResult[];
  keywordInHeadings: boolean;
}

export function analyzeHeadings(pages: CrawledPage[], brandTerms: string[] = []): HeadingResult {
  const pageResults: PageHeadingResult[] = [];
  let totalPages = 0;
  let goodPages = 0;
  let keywordFound = false;

  const lowerTerms = brandTerms.map((t) => t.toLowerCase()).filter((t) => t.length > 1);

  for (const page of pages) {
    const $ = cheerio.load(page.html);
    const headings: HeadingItem[] = [];
    totalPages++;

    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const tag = (el as cheerio.Element).tagName?.toLowerCase() || "";
      const text = $(el).text().trim();
      if (text) {
        headings.push({ level: tag, text });
      }
    });

    const h1Count = headings.filter((h) => h.level === "h1").length;

    let hasHierarchyIssues = false;
    let hasH2 = false;
    for (const h of headings) {
      if (h.level === "h2") hasH2 = true;
      if (h.level === "h3" && !hasH2) {
        hasHierarchyIssues = true;
        break;
      }
    }

    if (h1Count === 1 && !hasHierarchyIssues && headings.length > 0) {
      goodPages++;
    }

    if (lowerTerms.length > 0) {
      for (const h of headings) {
        if (h.level === "h1" || h.level === "h2") {
          const lowerText = h.text.toLowerCase();
          for (const term of lowerTerms) {
            if (lowerText.includes(term)) {
              keywordFound = true;
              break;
            }
          }
        }
        if (keywordFound) break;
      }
    }

    pageResults.push({
      url: page.url,
      h1Count,
      hasHierarchyIssues,
      headings: headings.slice(0, 20),
    });
  }

  let score = 0;
  if (totalPages > 0) {
    score = Math.round((goodPages / totalPages) * 70);
  }

  const hasHeadings = pageResults.some((p) => p.headings.length > 2);
  if (hasHeadings) score += 15;

  if (keywordFound || lowerTerms.length === 0) score += 15;

  score = Math.min(100, Math.max(0, score));

  return { score, pages: pageResults, keywordInHeadings: keywordFound };
}
