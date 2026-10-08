import type { InputParams } from "./report-export";

export interface StoredAnalysisInputs {
  companyName: string | null;
  buyerPersonas: string | null;
  competitors: string[];
  requestedPages: string[] | null;
  pageSelection: "manual" | "auto" | "mixed";
  excludedPages: string[] | null;
  autoAddedPages: string[];
}

export type ReportInputParams = InputParams & {
  inputsSource: "server" | "form";
  requestedPages: string[] | null;
  pageSelection: "manual" | "auto" | "mixed" | null;
};

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** Validate the server extension without trusting the generated client's types. */
export function readAnalysisInputs(value: unknown): StoredAnalysisInputs | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inputs = value as Record<string, unknown>;
  if (
    !nullableString(inputs.companyName) || !nullableString(inputs.buyerPersonas)
    || !stringArray(inputs.competitors)
    || !(inputs.requestedPages === null || stringArray(inputs.requestedPages))
    || (inputs.pageSelection !== "manual" && inputs.pageSelection !== "auto" && inputs.pageSelection !== "mixed")
    || !(inputs.excludedPages === undefined || inputs.excludedPages === null || stringArray(inputs.excludedPages))
    || !(inputs.autoAddedPages === undefined || stringArray(inputs.autoAddedPages))
  ) return null;
  return {
    companyName: inputs.companyName,
    buyerPersonas: inputs.buyerPersonas,
    competitors: [...inputs.competitors],
    requestedPages: inputs.requestedPages === null ? null : [...inputs.requestedPages],
    pageSelection: inputs.pageSelection,
    excludedPages: Array.isArray(inputs.excludedPages) ? [...inputs.excludedPages] as string[] : null,
    autoAddedPages: Array.isArray(inputs.autoAddedPages) ? [...inputs.autoAddedPages] as string[] : [],
  };
}

export function buildReportInputParams(
  report: unknown,
  domainForm: { companyName: string; personas: string; competitors: string[] },
  analysisDate = new Date().toLocaleString("de-DE"),
): ReportInputParams {
  const data = report && typeof report === "object" ? report as Record<string, unknown> : {};
  const inputs = readAnalysisInputs(data.inputs);
  return {
    domainUrl: String(data.url ?? ""),
    companyName: inputs ? inputs.companyName : domainForm.companyName.trim() || null,
    targetAudience: inputs ? inputs.buyerPersonas : domainForm.personas.trim() || null,
    competitors: inputs ? inputs.competitors : domainForm.competitors.filter((item) => item.trim()),
    analysisDate,
    crawledPagesCount: Array.isArray(data.crawledPages) ? data.crawledPages.length : 0,
    inputsSource: inputs ? "server" : "form",
    requestedPages: inputs?.requestedPages ?? null,
    pageSelection: inputs?.pageSelection ?? null,
    excludedPages: inputs?.excludedPages ?? null,
    autoAddedPages: inputs?.autoAddedPages ?? [],
  };
}