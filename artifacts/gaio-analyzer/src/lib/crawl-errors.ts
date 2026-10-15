import { labelDefaults } from "./labelDefaults";
import { defaultTechnicalT, type TechnicalT } from "./technical-breakdown";

const codes = new Set(["crawl_bot_protection", "crawl_parked_domain", "crawl_timed_out",
  "crawl_no_selected_page", "crawl_unreachable"]);

export interface FailureReport {
  errorCode?: unknown;
  blockedRobotsHint?: unknown;
  errors?: unknown;
}

// Keep legacy prose verbatim; never display serialized failure objects to visitors.
export function readableAnalysisError(value: unknown, t: TechnicalT): string {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && typeof parsed === "object") return readableAnalysisError(parsed, t);
    } catch { /* Existing plain-text errors are intentionally unchanged. */ }
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = value as Record<string, unknown>;
    const key = `results.crawl_reason_${String(error.reason ?? "unknown")}`;
    const reason = labelDefaults[key] ? t(key) : t("errors.crawl_unreachable_title");
    return typeof error.url === "string" ? `${error.url} – ${reason}` : reason;
  }
  return t("errors.crawl_unreachable_title");
}

export function crawlFailureMessage(report: FailureReport, t: TechnicalT = defaultTechnicalT) {
  const code = typeof report.errorCode === "string" && codes.has(report.errorCode) ? report.errorCode : null;
  if (!code) return null;
  return { title: t(`errors.${code}_title`), paragraphs: t(`errors.${code}_body`).split(/\n+/).filter(Boolean) };
}

export function robotsHintText(report: FailureReport, t: TechnicalT = defaultTechnicalT) {
  if (report.errorCode !== "crawl_bot_protection" || !report.blockedRobotsHint ||
      typeof report.blockedRobotsHint !== "object") return null;
  const hint = report.blockedRobotsHint as Record<string, unknown>;
  if (!["allowed", "blocked", "partial"].includes(String(hint.generalRule)) || !Array.isArray(hint.crawlers)) return null;
  const rule = t(`errors.robots_hint_general_${String(hint.generalRule)}`);
  const crawlers = hint.crawlers.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const { name, status } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !["allowed", "disallowed", "not_mentioned"].includes(String(status))) return [];
    const text = status === "allowed" ? t("errors.robots_hint_allowed")
      : status === "disallowed" ? t("errors.robots_hint_blocked") : t("errors.robots_hint_not_mentioned", { rule });
    return [`${name}: ${text}`];
  });
  const agents = Array.isArray(hint.fullyBlockedAgents)
    ? hint.fullyBlockedAgents.filter((agent): agent is string => typeof agent === "string") : [];
  return { title: t("errors.robots_hint_title"), crawlers,
    fullyBlocked: agents.length ? t("errors.robots_hint_fully_blocked", { agents: agents.join(", ") }) : null,
    note: t("errors.robots_hint_note") };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

export function renderCrawlFailureHtml(report: FailureReport, t: TechnicalT = defaultTechnicalT): string {
  const message = crawlFailureMessage(report, t);
  const hint = robotsHintText(report, t);
  if (!message) return "";
  return `<section><h2>${escapeHtml(message.title)}</h2>${message.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("")}
    ${hint ? `<section><h3>${escapeHtml(hint.title)}</h3><ul>${hint.crawlers.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
      ${hint.fullyBlocked ? `<p>${escapeHtml(hint.fullyBlocked)}</p>` : ""}<p>${escapeHtml(hint.note)}</p></section>` : ""}</section>`;
}
