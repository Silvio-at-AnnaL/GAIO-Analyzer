import { competitorKey, normalizeUrl } from "./utils";

export interface DomainPreparation {
  prepId: string;
  urlKey: string;
}

// competitorKey normalizes the host; retain the path to distinguish site sections.
export function preparationUrlKey(value: string): string {
  try {
    const url = new URL(normalizeUrl(value));
    const host = competitorKey(value);
    return host ? `${host}${url.pathname.replace(/\/+$/, "")}${url.search}` : "";
  } catch {
    return "";
  }
}

export function newDomainPreparation(url: string): DomainPreparation | null {
  try {
    const urlKey = preparationUrlKey(url);
    return urlKey ? { prepId: crypto.randomUUID(), urlKey } : null;
  } catch {
    // Correlation is optional and must never prevent a prefill.
    return null;
  }
}
