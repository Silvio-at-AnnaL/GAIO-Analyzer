import { callLLM, MissingApiKeyError, resolveLlmConfig } from "./ai-client.js";
import { logger } from "./logger.js";

const PREFLIGHT_CACHE_MS = 10 * 60 * 1_000;

export type LlmPreflightResult =
  | { ok: true; provider: string; model: string; durationMs: number; checkedAt: string }
  | { ok: false; provider: string; model: string; reason: "no_key" | "provider_error";
      status?: number; errorName?: string; durationMs: number };

let cached: Extract<LlmPreflightResult, { ok: true }> | null = null;
let cachedAt = 0;
let inFlight: Promise<LlmPreflightResult> | null = null;
let generation = 0;

export function resetLlmPreflightCache(): void {
  generation++;
  cached = null;
  cachedAt = 0;
  inFlight = null;
}

async function performCheck(checkGeneration: number): Promise<LlmPreflightResult> {
  const startedAt = Date.now();
  let provider = "claude";
  let model = "unknown";
  try {
    const config = await resolveLlmConfig();
    provider = config.provider;
    model = config.model;
    await callLLM("Reply with the single word OK.", 16, 0, {
      module: "preflight", timeoutMs: 15_000, maxRetries: 0,
    });
    const result: Extract<LlmPreflightResult, { ok: true }> = {
      ok: true, provider, model, durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
    if (generation === checkGeneration) {
      cached = result;
      cachedAt = Date.now();
    }
    logger.info({ provider, model, durationMs: result.durationMs, cached: false }, "llm preflight ok");
    return result;
  } catch (err) {
    if (generation === checkGeneration) {
      cached = null;
      cachedAt = 0;
    }
    const reason = err instanceof MissingApiKeyError ? "no_key" : "provider_error";
    const status = err !== null && typeof err === "object" && "status" in err
      && typeof err.status === "number" ? err.status : undefined;
    // Never expose the provider's error text (which could contain credentials).
    const rawName = err instanceof Error ? err.name : "UnknownError";
    const errorName = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(rawName) ? rawName : "UnknownError";
    const result: Extract<LlmPreflightResult, { ok: false }> = {
      ok: false, provider, model, reason,
      ...(status === undefined ? {} : { status }),
      errorName, durationMs: Date.now() - startedAt,
    };
    logger.warn({
      provider, model, reason, status, errorName, durationMs: result.durationMs,
    }, "llm preflight failed");
    return result;
  }
}

export function checkLlmReady({ force = false }: { force?: boolean } = {}): Promise<LlmPreflightResult> {
  if (!force && cached && Date.now() - cachedAt < PREFLIGHT_CACHE_MS) {
    logger.info({
      provider: cached.provider, model: cached.model, durationMs: cached.durationMs, cached: true,
    }, "llm preflight ok");
    return Promise.resolve(cached);
  }
  if (inFlight) return inFlight;
  const checkGeneration = generation;
  const pending = performCheck(checkGeneration).finally(() => {
    if (inFlight === pending) inFlight = null;
  });
  inFlight = pending;
  return pending;
}