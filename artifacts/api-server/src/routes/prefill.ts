import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function normaliseUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.includes(".")) return `https://${s}`;
  return null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^[-•*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

router.post("/prefill", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const company_name = typeof body.company_name === "string" ? body.company_name.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!company_name || !url) {
    res.status(400).json({ error: "company_name and url are required" });
    return;
  }

  const prompt = `You are a B2B market research assistant. Analyze the following company and provide structured information.

Company: ${company_name}
Website: ${url}

Based on the company name and website, understand the company's industry, products, and market position. Then provide:

1. TARGET AUDIENCES: A concise description of the primary B2B buyer personas for this company. Include: relevant industries, job titles/roles of decision makers, and key buying criteria. Write 3-5 sentences in German. Be specific to this company, not generic.

2. COMPETITORS: Identify 5-8 real direct competitors of this company. These must be actual companies with real websites that operate in the same market segment. Return only companies you are confident exist and compete directly.

Return ONLY valid JSON, no other text:
{
  "personas": "<German text describing target audiences and buyer personas>",
  "competitors": [
    { "name": "<company name>", "url": "https://..." },
    ...
  ]
}

All text fields must be in German. The personas field must be plain prose — no bullet points, no numbering, no markdown.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error({ rawText }, "Prefill: no JSON found in AI response");
      res.status(500).json({ error: "AI returned an unexpected format" });
      return;
    }

    let parsed2: { personas?: unknown; competitors?: unknown };
    try {
      parsed2 = JSON.parse(jsonMatch[0]);
    } catch {
      logger.error({ jsonMatch: jsonMatch[0] }, "Prefill: failed to parse JSON");
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    const personas = typeof parsed2.personas === "string"
      ? stripMarkdown(parsed2.personas)
      : "";

    const rawCompetitors = Array.isArray(parsed2.competitors) ? parsed2.competitors : [];
    const competitors = rawCompetitors
      .filter((c): c is { name: string; url: string } =>
        c && typeof c === "object" && typeof c.name === "string" && typeof c.url === "string"
      )
      .map((c) => ({ name: c.name.trim(), url: normaliseUrl(c.url) ?? c.url }))
      .filter((c) => c.url.startsWith("http"));

    res.json({ personas, competitors });
  } catch (err) {
    logger.error({ err }, "Prefill: AI call failed");
    res.status(500).json({ error: "AI service error" });
  }
});

export default router;
