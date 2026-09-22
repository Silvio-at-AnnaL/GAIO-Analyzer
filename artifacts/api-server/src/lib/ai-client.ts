import { getSetting } from "./admin-db.js";
import { logger } from "./logger.js";

// Model alias accepted by the Replit AI Integrations proxy.
const REPLIT_CLAUDE_MODEL = "claude-sonnet-4-6";

async function callWithClaude(
  apiKey: string, model: string, prompt: string, maxTokens: number, temperature: number
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  // Use the Replit AI Integrations proxy URL when available so the
  // stored key (which is the Replit dummy) routes correctly.
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || undefined;
  // The Replit proxy only accepts its own model aliases (e.g. claude-sonnet-4-6),
  // not the upstream versioned names (e.g. claude-sonnet-4-20250514).
  const effectiveModel = baseURL ? REPLIT_CLAUDE_MODEL : model;
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const resp = await client.messages.create({
    model: effectiveModel as Parameters<typeof client.messages.create>[0]["model"],
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });
  const block = resp.content[0];
  if (block.type !== "text") throw new Error("Non-text response from Claude");
  return block.text;
}

async function callWithOpenAI(
  apiKey: string, model: string, prompt: string, maxTokens: number, temperature: number, baseURL?: string
): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });
  return resp.choices[0]?.message?.content ?? "";
}

async function callWithGemini(
  apiKey: string, model: string, prompt: string, temperature: number
): Promise<string> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model, generationConfig: { temperature } });
  const result = await geminiModel.generateContent(prompt);
  return result.response.text();
}

async function callFallback(prompt: string, maxTokens: number, temperature: number): Promise<string> {
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  // Always use the Replit proxy alias here — do NOT read ai_model_claude,
  // because that setting may contain an upstream versioned name the proxy rejects.
  const resp = await anthropic.messages.create({
    model: REPLIT_CLAUDE_MODEL as Parameters<typeof anthropic.messages.create>[0]["model"],
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });
  const block = resp.content[0];
  if (block.type !== "text") throw new Error("Non-text response from fallback");
  return block.text;
}

export async function callLLM(prompt: string, maxTokens = 4096, temperature = 0): Promise<string> {
  let provider = "claude";
  let customProviders: Array<{
    id: string;
    api_key: string;
    base_url: string;
    model: string;
    enabled: boolean;
  }> = [];

  try {
    const configuredProvider = await getSetting("ai_provider") ?? "claude";
    const customJson = await getSetting("ai_custom_providers") ?? "[]";
    let configuredCustomProviders: typeof customProviders = [];
    try {
      configuredCustomProviders = JSON.parse(customJson) as typeof customProviders;
    } catch {
      // Ignore malformed custom-provider configuration as before.
    }
    provider = configuredProvider;
    customProviders = configuredCustomProviders;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message },
      "callLLM settings unavailable — using default provider",
    );
    provider = "claude";
    customProviders = [];
  }

  try {
    // Check custom (OpenAI-compatible) providers first
    const customProv = customProviders.find(p => p.id === provider && p.enabled);
    if (customProv && customProv.api_key) {
      return await callWithOpenAI(
        customProv.api_key,
        customProv.model,
        prompt,
        maxTokens,
        temperature,
        customProv.base_url,
      );
    }

    switch (provider) {
      case "openai": {
        const apiKey = await getSetting("ai_api_key_openai") ?? "";
        const model  = await getSetting("ai_model_openai") ?? "gpt-4o";
        if (apiKey) return await callWithOpenAI(apiKey, model, prompt, maxTokens, temperature);
        break;
      }
      case "perplexity": {
        const apiKey = await getSetting("ai_api_key_perplexity") ?? "";
        const model  = await getSetting("ai_model_perplexity") ?? "llama-3.1-sonar-large-128k-online";
        if (apiKey) {
          return await callWithOpenAI(
            apiKey,
            model,
            prompt,
            maxTokens,
            temperature,
            "https://api.perplexity.ai",
          );
        }
        break;
      }
      case "gemini": {
        const apiKey = await getSetting("ai_api_key_gemini") ?? "";
        const model  = await getSetting("ai_model_gemini") ?? "gemini-1.5-pro";
        if (apiKey) return await callWithGemini(apiKey, model, prompt, temperature);
        break;
      }
      case "claude":
      default: {
        const apiKey = await getSetting("ai_api_key_claude") ?? "";
        const model  = await getSetting("ai_model_claude") ?? "claude-sonnet-4-20250514";
        if (apiKey) return await callWithClaude(apiKey, model, prompt, maxTokens, temperature);
        break;
      }
    }
  } catch (err) {
    logger.warn({ err, provider }, "Configured AI provider failed, falling back to Replit integration");
  }

  return callFallback(prompt, maxTokens, temperature);
}
