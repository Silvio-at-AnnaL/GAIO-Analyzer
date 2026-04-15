import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";

export interface FaqResult {
  score: number;
  faqItemsFound: number;
  hasFaqSchema: boolean;
  hasHtmlFaq: boolean;
  qualityAssessment: string | null;
}

function detectFaqFromSchema(html: string): number {
  let count = 0;
  const $ = cheerio.load(html);

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html();
      if (!text) return;
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item["@type"] === "FAQPage" && Array.isArray(item.mainEntity)) {
          count += item.mainEntity.length;
        }
        if (item["@graph"]) {
          for (const g of item["@graph"] as Array<Record<string, unknown>>) {
            if (g["@type"] === "FAQPage" && Array.isArray(g.mainEntity)) {
              count += (g.mainEntity as unknown[]).length;
            }
          }
        }
      }
    } catch {
      // skip
    }
  });

  return count;
}

function detectFaqFromHtml(html: string): number {
  const $ = cheerio.load(html);
  let count = 0;

  count += $("details summary").length;

  const faqPatterns = [
    ".faq",
    ".FAQ",
    '[class*="faq"]',
    '[class*="FAQ"]',
    '[id*="faq"]',
    '[id*="FAQ"]',
    ".accordion",
    '[class*="accordion"]',
  ];

  for (const pattern of faqPatterns) {
    const items = $(pattern);
    if (items.length > 0) {
      count += items.length;
      break;
    }
  }

  const headingPattern = /^(Was |Wie |Warum |Wann |Wo |Wer |Welche |Can |How |What |Why |When |Where |Who |Which |Is |Do |Does )/i;
  $("h2, h3, h4").each((_, el) => {
    const text = $(el).text().trim();
    if (text.endsWith("?") || headingPattern.test(text)) {
      count++;
    }
  });

  return count;
}

export async function analyzeFaq(pages: CrawledPage[]): Promise<FaqResult> {
  let totalSchemaFaq = 0;
  let totalHtmlFaq = 0;

  for (const page of pages) {
    totalSchemaFaq += detectFaqFromSchema(page.html);
    totalHtmlFaq += detectFaqFromHtml(page.html);
  }

  const hasFaqSchema = totalSchemaFaq > 0;
  const hasHtmlFaq = totalHtmlFaq > 0;
  const faqItemsFound = Math.max(totalSchemaFaq, totalHtmlFaq);

  let qualityAssessment: string | null = null;

  if (faqItemsFound > 0) {
    try {
      const faqContent = pages
        .map((p) => {
          const $ = cheerio.load(p.html);
          const faqTexts: string[] = [];
          $("details, .faq, [class*='faq'], [class*='accordion']").each((_, el) => {
            faqTexts.push($(el).text().trim().slice(0, 500));
          });
          $("h2, h3, h4").each((_, el) => {
            const text = $(el).text().trim();
            if (text.endsWith("?")) {
              const next = $(el).next().text().trim().slice(0, 300);
              faqTexts.push(`Q: ${text}\nA: ${next}`);
            }
          });
          return faqTexts.join("\n");
        })
        .filter((t) => t.length > 10)
        .join("\n---\n")
        .slice(0, 3000);

      if (faqContent.length > 50) {
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [
            {
              role: "user",
              content: `Evaluate this FAQ content from a B2B industrial website. Are the questions framed as real user questions? Do answers have sufficient depth? Give a 2-3 sentence assessment.\n\n${faqContent}`,
            },
          ],
        });
        const block = message.content[0];
        qualityAssessment = block.type === "text" ? block.text : null;
      }
    } catch (err) {
      logger.warn({ err }, "FAQ quality assessment failed");
    }
  }

  let score = 0;
  if (hasFaqSchema) score += 40;
  if (hasHtmlFaq) score += 25;
  if (faqItemsFound >= 5) score += 15;
  else if (faqItemsFound >= 2) score += 10;
  else if (faqItemsFound >= 1) score += 5;

  if (qualityAssessment && !qualityAssessment.toLowerCase().includes("poor")) {
    score += 20;
  }

  score = Math.min(100, Math.max(0, score));

  return { score, faqItemsFound, hasFaqSchema, hasHtmlFaq, qualityAssessment };
}
