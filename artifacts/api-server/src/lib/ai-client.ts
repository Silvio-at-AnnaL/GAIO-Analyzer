import { getSetting } from "./admin-db.js";
import { logger } from "./logger.js";

const CALL_LLM_TIMEOUT_MS = 120_000;
const CALL_LLM_MAX_RETRIES = 2;

interface ProviderResponse {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class MissingApiKeyError extends Error {}

interface LlmConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  kind: "claude" | "openai" | "gemini";
}

interface LlmCallOptions {
  module?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

async function callWithClaude(
  apiKey: string, model: string, prompt: string, maxTokens: number, temperature: number,
  timeoutMs: number, maxRetries: number,
): Promise<ProviderResponse> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({
    apiKey, timeout: timeoutMs, maxRetries,
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
  apiKey: string, model: string, prompt: string, maxTokens: number, temperature: number,
  timeoutMs: number, maxRetries: number, baseURL?: string,
): Promise<ProviderResponse> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey, ...(baseURL ? { baseURL } : {}),
    timeout: timeoutMs, maxRetries,
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

async function resolveLlmConfigInternal(): Promise<LlmConfig> {
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

  const customProv = customProviders.find(p => p.id === provider && p.enabled);
  if (customProv) return {
    provider, model: customProv.model, apiKey: customProv.api_key ?? "", baseURL: customProv.base_url,
    kind: "openai",
  };
  switch (provider) {
    case "openai":
      return { provider, apiKey: await getSetting("ai_api_key_openai") ?? "",
        model: await getSetting("ai_model_openai") ?? "gpt-4o", kind: "openai" };
    case "perplexity":
      return { provider, apiKey: await getSetting("ai_api_key_perplexity") ?? "",
        model: await getSetting("ai_model_perplexity") ?? "llama-3.1-sonar-large-128k-online",
        baseURL: "https://api.perplexity.ai", kind: "openai" };
    case "gemini":
      return { provider, apiKey: await getSetting("ai_api_key_gemini") ?? "",
        model: await getSetting("ai_model_gemini") ?? "gemini-1.5-pro", kind: "gemini" };
    case "claude":
      return { provider, apiKey: await getSetting("ai_api_key_claude") ?? "",
        model: await getSetting("ai_model_claude") ?? "claude-sonnet-4-20250514", kind: "claude" };
    default:
      return { provider, apiKey: "", model: "unknown", kind: "claude" };
  }
}

export async function resolveLlmConfig(): Promise<{ provider: string; model: string; hasKey: boolean }> {
  const { provider, model, apiKey } = await resolveLlmConfigInternal();
  return { provider, model, hasKey: !!apiKey };
}

export async function callLLM(
  prompt: string, maxTokens = 4096, temperature = 0, options: LlmCallOptions = {},
): Promise<string> {
  const startedAt = Date.now();
  const module = options.module ?? "unknown";
  const timeoutMs = options.timeoutMs ?? CALL_LLM_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? CALL_LLM_MAX_RETRIES;
  let provider = "claude";
  let apiKey = "";
  let model = "unknown";
  try {
    const config = await resolveLlmConfigInternal();
    ({ provider, model, apiKey } = config);
    if (!apiKey) {
      logger.warn({ provider, module }, "callLLM: no API key configured");
      throw new MissingApiKeyError(`No API key configured for ${provider}`);
    }
    let response: ProviderResponse;
    if (config.kind === "openai") {
      response = await callWithOpenAI(
        apiKey, model, prompt, maxTokens, temperature, timeoutMs, maxRetries, config.baseURL,
      );
    } else if (config.kind === "gemini") {
      response = await callWithGemini(apiKey, model, prompt, temperature);
    } else {
      response = await callWithClaude(apiKey, model, prompt, maxTokens, temperature, timeoutMs, maxRetries);
    }
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
