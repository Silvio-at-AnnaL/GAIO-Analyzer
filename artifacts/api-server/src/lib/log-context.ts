import { AsyncLocalStorage } from "node:async_hooks";

const analysisContext = new AsyncLocalStorage<{ analysisId: string }>();

export function runWithAnalysisContext<T>(
  analysisId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return analysisContext.run({ analysisId }, fn);
}

export function getAnalysisId(): string | undefined {
  return analysisContext.getStore()?.analysisId;
}