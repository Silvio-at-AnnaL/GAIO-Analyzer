import { getSetting } from "./admin-db.js";
import { logger } from "./logger.js";

const CALL_LLM_TIMEOUT_MS = 120_000;
const CALL_LLM_MAX_RETRIES = 2;

interface ProviderResponse {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

class MissingApiKeyError extends Error {}

async function callWithClaude(
  apiKey: string, model: string, prompt: string, maxTokens: number, temperature: number,
): Promise<ProviderResponse> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({
    apiKey, timeout: CALL_LLM_TIMEOUT_MS, maxRetries: CALL_LLM_MAX_RETRIES,
  });
  const resp = await client.messages.create({
    model: model as Parameters<typeof client.messages.create>[0]["model"],
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });
  const block = resp.content[0];
  if (block?.type !== "text") throw new Error("Non-text response from Claude");
  return {
    text: block.text,
    inputTokens: resp.usage?.input_tokens ?? null,
    outputTokens: resp.usage?.output_tokens ?? null,
  };
}

async function callWithOpenAI(
  apiKey: string, model: string, prompt: string, maxTokens: number, temperature: number, baseURL?: string
): Promise<ProviderResponse> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey, ...(baseURL ? { baseURL } : {}),
    timeout: CALL_LLM_TIMEOUT_MS, maxRetries: CALL_LLM_MAX_RETRIES,
  });
  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });
  return {
    text: resp.choices[0]?.message?.content ?? "",
    inputTokens: resp.usage?.prompt_tokens ?? null,
    outputTokens: resp.usage?.completion_tokens ?? null,
  };
}

async function callWithGemini(
  apiKey: string, model: string, prompt: string, temperature: number
): Promise<ProviderResponse> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model, generationConfig: { temperature } });
  const result = await geminiModel.generateContent(prompt);
  return { text: result.response.text(), inputTokens: null, outputTokens: null };
}

export async function callLLM(
  prompt: string, maxTokens = 4096, temperature = 0, options: { module?: string } = {},
): Promise<string> {
  const startedAt = Date.now();
  const module = options.module ?? "unknown";
  let provider = "claude";
  let apiKey = "";
  let model = "unknown";
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
      const parsed: unknown = JSON.parse(customJson);
      if (Array.isArray(parsed)) configuredCustomProviders = parsed as typeof customProviders;
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
    const customProv = customProviders.find(p => p.id === provider && p.enabled);
    let call: Promise<ProviderResponse> | undefined;
    if (customProv) {
      apiKey = customProv.api_key ?? "";
      model = customProv.model;
      if (apiKey) call = callWithOpenAI(apiKey, model, prompt, maxTokens, temperature, customProv.base_url);
    } else {
      switch (provider) {
        case "openai":
          apiKey = await getSetting("ai_api_key_openai") ?? "";
          model = await getSetting("ai_model_openai") ?? "gpt-4o";
          if (apiKey) call = callWithOpenAI(apiKey, model, prompt, maxTokens, temperature);
          break;
        case "perplexity":
          apiKey = await getSetting("ai_api_key_perplexity") ?? "";
          model = await getSetting("ai_model_perplexity") ?? "llama-3.1-sonar-large-128k-online";
          if (apiKey) call = callWithOpenAI(apiKey, model, prompt, maxTokens, temperature, "https://api.perplexity.ai");
          break;
        case "gemini":
          apiKey = await getSetting("ai_api_key_gemini") ?? "";
          model = await getSetting("ai_model_gemini") ?? "gemini-1.5-pro";
          if (apiKey) call = callWithGemini(apiKey, model, prompt, temperature);
          break;
        case "claude":
          apiKey = await getSetting("ai_api_key_claude") ?? "";
          model = await getSetting("ai_model_claude") ?? "claude-sonnet-4-20250514";
          if (apiKey) call = callWithClaude(apiKey, model, prompt, maxTokens, temperature);
          break;
      }
    }
    if (!apiKey) {
      logger.warn({ provider, module }, "callLLM: no API key configured");
      throw new MissingApiKeyError(`No API key configured for ${provider}`);
    }
    const response = await call!;
    logger.info({
      provider, route: "direct", model, module, durationMs: Date.now() - startedAt,
      inputTokens: response.inputTokens, outputTokens: response.outputTokens,
    }, "callLLM route");
    return response.text;
  } catch (err) {
    if (err instanceof MissingApiKeyError) throw err;
    const redact = (value: string) => apiKey ? value.replaceAll(apiKey, "[REDACTED]") : "[REDACTED]";
    const status = err !== null && typeof err === "object" && "status" in err
      && typeof err.status === "number" ? err.status : undefined;
    logger.warn(
      {
        provider, model, module, durationMs: Date.now() - startedAt,
        errorName: redact(err instanceof Error ? err.name : "UnknownError"),
        ...(status === undefined ? {} : { status }),
        errorMessage: redact(err instanceof Error ? err.message : String(err)),
      },
      "callLLM provider failed",
    );
    throw err;
  }
}
