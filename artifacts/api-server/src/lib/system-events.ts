import { query } from "./db.js";
import { setLogSink, type LogSinkEntry } from "./logger.js";

export const RETENTION_DAYS = 30;

const FLUSH_INTERVAL_MS = 5_000;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MAX_BUFFER_SIZE = 1_000;
const FLUSH_SIZE = 50;
const MAX_CONTEXT_CHARS = 4_000;
const ERROR_REPORT_INTERVAL_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REDACTED_KEY_PATTERN = /pass(word)?|secret|token|api[_-]?key|authorization|cookie/i;
const EXCLUDED_CONTEXT_KEYS = new Set([
  "analysisId", "req", "res", "time", "pid", "hostname", "level", "msg",
]);

export const PERSISTED_INFO_MESSAGES = new Set([
  "Analysis completed",
  "competitor input normalized",
  "recommendations input built",
  "AI recommendations response",
  "recommendations generation finished",
  "Prefill: validation complete",
  "Prefill: crawl complete",
  "Prefill: competitor relevance verdict",
  "Prefill: competitor dropped by relevance",
  "Prefill: market region derived",
  "Prefill: duplicate competitor host dropped",
  "Prefill: no competitor has sufficient evidence for relevance check",
]);

interface BufferedSystemEvent {
  level: number;
  msg: string;
  analysisId: string | null;
  context: Record<string, unknown> | null;
}

const buffer: BufferedSystemEvent[] = [];
let initialized = false;
let flushing = false;
let droppedEntries = 0;
let lastFlushErrorAt = 0;
let lastRetentionErrorAt = 0;

function reportError(kind: "flush" | "retention", error: unknown): void {
  const now = Date.now();
  const lastReported = kind === "flush" ? lastFlushErrorAt : lastRetentionErrorAt;
  if (now - lastReported < ERROR_REPORT_INTERVAL_MS) return;
  if (kind === "flush") lastFlushErrorAt = now;
  else lastRetentionErrorAt = now;
  console.error(`System event ${kind} failed:`, error);
}

function reduceValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return {
      type: value.name,
      message: value.message,
      stack: value.stack?.split("\n").slice(0, 5).join("\n"),
    };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return value.map((item) => reduceValue(item, seen));
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const reduced: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      reduced[key] = key !== "passt" && REDACTED_KEY_PATTERN.test(key)
        ? "[redacted]"
        : reduceValue(nestedValue, seen);
    }
    return reduced;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function buildContext(obj: Record<string, unknown>): Record<string, unknown> | null {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!EXCLUDED_CONTEXT_KEYS.has(key)) filtered[key] = value;
  }
  if (Object.keys(filtered).length === 0) return null;

  const reduced = reduceValue(filtered, new WeakSet()) as Record<string, unknown>;
  let serialized: string;
  try {
    serialized = JSON.stringify(reduced);
  } catch {
    return { serializationError: true };
  }
  if (serialized.length <= MAX_CONTEXT_CHARS) return reduced;

  let previewLength = MAX_CONTEXT_CHARS - 100;
  let truncated: Record<string, unknown>;
  do {
    truncated = {
      truncated: true,
      preview: `${serialized.slice(0, previewLength)}...[truncated]`,
    };
    previewLength -= 100;
  } while (JSON.stringify(truncated).length > MAX_CONTEXT_CHARS && previewLength > 0);
  return truncated;
}

function shouldPersist({ level, msg }: LogSinkEntry): boolean {
  if (msg === "request completed") return false;
  return level >= 40 || (level === 30 && PERSISTED_INFO_MESSAGES.has(msg));
}

function receiveLog(entry: LogSinkEntry): void {
  try {
    if (!shouldPersist(entry)) return;
    const fallbackId = typeof entry.obj.id === "string" && UUID_PATTERN.test(entry.obj.id)
      ? entry.obj.id
      : null;
    const analysisId = typeof entry.obj.analysisId === "string"
      ? entry.obj.analysisId
      : fallbackId;

    buffer.push({
      level: entry.level,
      msg: entry.msg,
      analysisId,
      context: buildContext(entry.obj),
    });
    if (buffer.length > MAX_BUFFER_SIZE) {
      const overflow = buffer.length - MAX_BUFFER_SIZE;
      buffer.splice(0, overflow);
      droppedEntries += overflow;
    }
    if (buffer.length >= FLUSH_SIZE) void flushSystemEvents();
  } catch {
    // Persistence must never affect the original log call.
  }
}

async function flushSystemEvents(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    const params: unknown[] = [];
    const values = batch.map((entry, index) => {
      const offset = index * 4;
      params.push(entry.level, entry.msg, entry.analysisId, entry.context);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb)`;
    });
    await query(
      `INSERT INTO system_events (level, msg, analysis_id, context)
       VALUES ${values.join(", ")}`,
      params,
    );
    if (droppedEntries > 0) {
      console.error(`System event buffer dropped ${droppedEntries} oldest entries`);
      droppedEntries = 0;
    }
  } catch (error) {
    reportError("flush", error);
  } finally {
    flushing = false;
    if (buffer.length >= FLUSH_SIZE) void flushSystemEvents();
  }
}

async function runRetention(): Promise<void> {
  try {
    await query(
      `DELETE FROM system_events
       WHERE created_at < NOW() - INTERVAL '30 days'`,
    );
  } catch (error) {
    reportError("retention", error);
  }
}

export function initSystemEventLog(): void {
  if (initialized) return;
  initialized = true;
  setLogSink(receiveLog);
  const flushTimer = setInterval(() => void flushSystemEvents(), FLUSH_INTERVAL_MS);
  const retentionTimer = setInterval(() => void runRetention(), RETENTION_INTERVAL_MS);
  flushTimer.unref();
  retentionTimer.unref();
  void runRetention();
}