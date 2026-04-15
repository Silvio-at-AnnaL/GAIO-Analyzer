import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";

export interface Recommendation {
  tier: "critical" | "high_leverage" | "secondary";
  finding: string;
  whyItMatters: string;
  fixInstruction: string;
}

export async function generateRecommendations(
  moduleResults: Record<string, unknown>,
): Promise<Recommendation[]> {
  const defaultRecs: Recommendation[] = [];

  try {
    const resultsStr = JSON.stringify(moduleResults, null, 2).slice(0, 12000);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Based on these website analysis findings, generate a prioritized action list grouped into three tiers:

- "critical": must be fixed immediately (broken fundamentals: missing canonical, no HTTPS, 0 structured data, H1 absent)
- "high_leverage": changes likely to produce major visibility gains (missing FAQPage schema, thin content, no use-case descriptions, hreflang errors, missing Organization schema)
- "secondary": improvements for after critical + high-leverage are resolved (meta description length, image alt gaps, heading hierarchy inconsistencies)

Each recommendation must include:
- What exactly is wrong (specific page/element if possible)
- Why it matters for LLM discoverability and/or classic SEO
- Concrete fix instruction (code snippet or content guidance)

Analysis findings:
${resultsStr}

Return a JSON array (no markdown) of objects:
[{"tier": "critical|high_leverage|secondary", "finding": "...", "whyItMatters": "...", "fixInstruction": "..."}]`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") return defaultRecs;

    const match = block.text.match(/\[[\s\S]*\]/);
    if (!match) return defaultRecs;

    const parsed: Recommendation[] = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : defaultRecs;
  } catch (err) {
    logger.warn({ err }, "Recommendation generation failed");
    return defaultRecs;
  }
}
