import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContext {
  analysisId?: string;
  prepId?: string;
}

const analysisContext = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return analysisContext.run({ ...analysisContext.getStore(), ...ctx }, fn);
}

/** Accept UUIDs of any version and canonicalize case for TEXT-column joins. */
export function parsePrepId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

export function runWithAnalysisContext<T>(
  analysisId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithLogContext({ analysisId }, fn);
}

export function getAnalysisId(): string | undefined {
  return analysisContext.getStore()?.analysisId;
}

export function getPrepId(): string | undefined {
  return analysisContext.getStore()?.prepId;
}