import { getSetting } from "./admin-db.js";
import { logger } from "./logger.js";

async function callWithClaude(
  apiKey: string, model: string, prompt: string, maxTokens: number
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: model as Parameters<typeof client.messages.create>[0]["model"],
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const block = resp.content[0];
  if (block.type !== "text") throw new Error("Non-text response from Claude");
  return block.text;
}

async function callWithOpenAI(
  apiKey: string, model: string, prompt: string, maxTokens: number, baseURL?: string
): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return resp.choices[0]?.message?.content ?? "";
}

async function callWithGemini(
  apiKey: string, model: string, prompt: string
): Promise<string> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });
  const result = await geminiModel.generateContent(prompt);
  return result.response.text();
}

async function callFallback(prompt: string, maxTokens: number): Promise<string> {
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  const model = getSetting("ai_model_claude") ?? "claude-sonnet-4-6";
  const resp = await anthropic.messages.create({
    model: model as Parameters<typeof anthropic.messages.create>[0]["model"],
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const block = resp.content[0];
  if (block.type !== "text") throw new Error("Non-text response from fallback");
  return block.text;
}

export async function callLLM(prompt: string, maxTokens = 4096): Promise<string> {
  const provider = getSetting("ai_provider") ?? "claude";

  try {
    switch (provider) {
      case "openai": {
        const apiKey = getSetting("ai_api_key_openai") ?? "";
        const model  = getSetting("ai_model_openai") ?? "gpt-4o";
        if (apiKey) return await callWithOpenAI(apiKey, model, prompt, maxTokens);
        break;
      }
      case "perplexity": {
        const apiKey = getSetting("ai_api_key_perplexity") ?? "";
        const model  = getSetting("ai_model_perplexity") ?? "llama-3.1-sonar-large-128k-online";
        if (apiKey) return await callWithOpenAI(apiKey, model, prompt, maxTokens, "https://api.perplexity.ai");
        break;
      }
      case "gemini": {
        const apiKey = getSetting("ai_api_key_gemini") ?? "";
        const model  = getSetting("ai_model_gemini") ?? "gemini-1.5-pro";
        if (apiKey) return await callWithGemini(apiKey, model, prompt);
        break;
      }
      case "claude":
      default: {
        const apiKey = getSetting("ai_api_key_claude") ?? "";
        const model  = getSetting("ai_model_claude") ?? "claude-sonnet-4-20250514";
        if (apiKey) return await callWithClaude(apiKey, model, prompt, maxTokens);
        break;
      }
    }
  } catch (err) {
    logger.warn({ err, provider }, "Configured AI provider failed, falling back to Replit integration");
  }

  return callFallback(prompt, maxTokens);
}
