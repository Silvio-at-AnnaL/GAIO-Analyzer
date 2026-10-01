import { parseReportSetup, type ReportSetup, type ReportSetupResult } from "./report-setup";
import type { DomainForm } from "../store/appStore";

export const MAX_SETUP_FILE_BYTES = 20 * 1024 * 1024;
export type SetupImportNotice = {
  source: "block-v2" | "fallback";
  exportDate: string | null;
  warnings: string[];
  count: number;
};
type ParsedSetup = Extract<ReportSetupResult, { ok: true }>;
export type SetupImportResult =
  | { ok: true; parsed: ParsedSetup }
  | { ok: false; reason: Extract<ReportSetupResult, { ok: false }>["reason"] | "read" }
  | { ok: false; cancelled: true };

export function hasSetupContent(form: DomainForm, pages: string[][]): boolean {
  return Boolean(form.companyName.trim() || form.url.trim() || form.personas.trim()
    || form.competitors.some((item) => item.trim()) || pages.some((list) => list.length));
}

export function setupToDomainForm(setup: ReportSetup): DomainForm {
  const competitors = setup.competitors.slice(0, 5);
  return {
    companyName: setup.companyName ?? "",
    url: setup.url ?? "",
    personas: setup.persona ?? "",
    competitors: competitors.length < 5 ? [...competitors, ""] : competitors,
  };
}

/** Keep parsing and overwrite confirmation ahead of every state mutation. */
export async function prepareSetupImport<T extends { size: number }>(
  file: T,
  options: {
    readText: (file: T) => Promise<string>;
    hasContent: () => boolean;
    confirm: () => boolean;
  },
): Promise<SetupImportResult> {
  if (file.size > MAX_SETUP_FILE_BYTES) return { ok: false, reason: "read" };
  let html: string;
  try {
    html = await options.readText(file);
  } catch {
    return { ok: false, reason: "read" };
  }
  const parsed = parseReportSetup(html);
  if (!parsed.ok) return parsed;
  if (options.hasContent() && !options.confirm()) return { ok: false, cancelled: true };
  return { ok: true, parsed };
}

export function formatSetupExportDate(date: string | null): string {
  if (!date) return "unbekanntem Datum";
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? "unbekanntem Datum" : value.toLocaleString("de-DE");
}