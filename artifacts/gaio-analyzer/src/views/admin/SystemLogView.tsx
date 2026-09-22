import { Fragment, useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import { adminFetch, useAuth } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { useT, useLabelContext } from "@/lib/LabelProvider";
import { ChevronDown, ChevronUp } from "lucide-react";

interface SystemEvent {
  id: string;
  createdAt: string;
  level: number;
  msg: string;
  analysisId: string | null;
  analysisDomain: string | null;
  context: Record<string, unknown> | null;
}

interface SystemLogResponse {
  events: SystemEvent[];
  nextBeforeId: string | null;
}

function LevelBadge({ level, t }: { level: number; t: (k: string) => string }) {
  const label = level >= 60
    ? t("systemlog.level_fatal")
    : level >= 50
      ? t("systemlog.level_error")
      : level >= 40
        ? t("systemlog.level_warn")
        : t("systemlog.level_info");

  let bg = "hsl(var(--muted))";
  let color = "hsl(var(--muted-foreground))";

  if (level >= 50) {
    bg = "#7f1d1d";
    color = "#fca5a5";
  } else if (level >= 40) {
    bg = "#78350f";
    color = "#fcd34d";
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${level >= 60 ? "font-bold" : "font-medium"}`}
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function formatTimestampSeconds(value: string | null | undefined, locale: string): string {
  if (!value) return "–";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SystemLogView({ initialAnalysisId }: { initialAnalysisId?: string }) {
  const t = useT();
  const { locale } = useLabelContext();
  const intlLocale = locale === "en" ? "en-US" : "de-DE";
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { setActiveView, setSystemLogAnalysisId } = useAppStore();

  const urlAnalysisId = new URLSearchParams(window.location.search).get("analysisId");
  const startingAnalysisId = initialAnalysisId || urlAnalysisId || "";
  const initialMinLevel = startingAnalysisId ? "30" : "40";

  const [activeFilters, setActiveFilters] = useState({
    from: "",
    to: "",
    minLevel: initialMinLevel,
    analysisId: startingAnalysisId,
    q: "",
  });

  const [from, setFrom] = useState(activeFilters.from);
  const [to, setTo] = useState(activeFilters.to);
  const [minLevel, setMinLevel] = useState(activeFilters.minLevel);
  const [analysisId, setAnalysisId] = useState(activeFilters.analysisId);
  const [q, setQ] = useState(activeFilters.q);

  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [nextBeforeId, setNextBeforeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAppending, setIsAppending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedContexts, setExpandedContexts] = useState<Record<string, boolean>>({});
  const requestGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const baseRequestPending = useRef(false);

  const fetchLogs = useCallback(
    async (append = false, beforeId?: string) => {
      if (append && baseRequestPending.current) return;
      if (!append) {
        requestGeneration.current += 1;
        baseRequestPending.current = true;
        setNextBeforeId(null);
      }
      const generation = requestGeneration.current;
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;

      setIsAppending(append);
      setIsLoading(!append);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (activeFilters.from) params.set("from", activeFilters.from);
        if (activeFilters.to) params.set("to", activeFilters.to);
        if (activeFilters.minLevel) params.set("minLevel", activeFilters.minLevel);
        if (activeFilters.analysisId) params.set("analysisId", activeFilters.analysisId);
        if (activeFilters.q.trim()) params.set("q", activeFilters.q.trim());
        params.set("limit", "50");
        if (beforeId) params.set("beforeId", beforeId);

        const res = await adminFetch(`/api/admin/system-events?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || t("systemlog.error"));
        }

        const data = (await res.json()) as SystemLogResponse;
        if (controller.signal.aborted || generation !== requestGeneration.current) return;
        if (append) {
          setEvents((prev) => [...prev, ...data.events]);
        } else {
          setEvents(data.events);
        }
        setNextBeforeId(data.nextBeforeId);
      } catch (err) {
        if (controller.signal.aborted || generation !== requestGeneration.current) return;
        setError(err instanceof Error ? err.message : t("systemlog.error"));
      } finally {
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          if (!append) baseRequestPending.current = false;
          setIsAppending(false);
          setIsLoading(false);
        }
      }
    },
    [activeFilters, t]
  );

  useEffect(() => {
    if (isAuthenticated && user?.role === "admin") {
      fetchLogs();
    }
  }, [isAuthenticated, user, fetchLogs]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const handleFilter = (e?: FormEvent) => {
    if (e) e.preventDefault();
    setActiveFilters({ from, to, minLevel, analysisId, q });
  };

  const handleReset = () => {
    setFrom("");
    setTo("");
    setMinLevel("40");
    setAnalysisId("");
    setQ("");
    setSystemLogAnalysisId(null);
    setActiveFilters({ from: "", to: "", minLevel: "40", analysisId: "", q: "" });
  };

  const showAllEvents = () => {
    setAnalysisId("");
    setSystemLogAnalysisId(null);
    setActiveFilters((prev) => ({ ...prev, analysisId: "" }));
  };

  const handleAnalysisClick = (clickedId: string) => {
    setAnalysisId(clickedId);
    setActiveFilters((prev) => ({ ...prev, analysisId: clickedId }));
  };

  const toggleContext = (id: string) => {
    setExpandedContexts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (authLoading) {
    return <div className="p-8 text-muted-foreground text-sm">{t("systemlog.loading")}</div>;
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="max-w-md mx-auto mt-16 space-y-4">
        <p className="text-muted-foreground">{t("systemlog.error")}</p>
        <button
          className="text-sm underline text-primary"
          onClick={() => setActiveView(7)}
          data-testid="button-login-redirect"
        >
          {t("auth.go_to_login_button")}
        </button>
      </div>
    );
  }

  const cardStyle = {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
  };
  const inputStyle = {
    background: "hsl(var(--input))",
    border: "1px solid hsl(var(--border))",
    color: "hsl(var(--foreground))",
  };
  const filteredAnalysisDomain = activeFilters.analysisId
    ? events.find((event) => event.analysisId === activeFilters.analysisId)?.analysisDomain ?? null
    : null;

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("systemlog.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("systemlog.retention_hint")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("systemlog.analysis_filter_hint")}
          </p>
        </div>
      </div>

      <form
        onSubmit={handleFilter}
        className="flex flex-wrap gap-4 p-4 rounded-xl items-end"
        style={cardStyle}
      >
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("systemlog.filter_from")}
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm"
            style={inputStyle}
            data-testid="input-filter-from"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("systemlog.filter_to")}
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm"
            style={inputStyle}
            data-testid="input-filter-to"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("systemlog.filter_level")}
          </label>
          <select
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm"
            style={inputStyle}
            data-testid="select-filter-severity"
          >
            <option value="40">{t("systemlog.level_opt_warn")}</option>
            <option value="50">{t("systemlog.level_opt_error")}</option>
            <option value="30">{t("systemlog.level_opt_all")}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("systemlog.filter_analysis")}
          </label>
          <input
            type="text"
            value={analysisId}
            onChange={(e) => setAnalysisId(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm w-32"
            style={inputStyle}
            data-testid="input-filter-analysis"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground">
            {t("systemlog.filter_search")}
          </label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm w-full"
            style={inputStyle}
            data-testid="input-filter-search"
          />
        </div>

        <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0 sm:ml-auto">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-muted"
            style={{ border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            data-testid="button-reset"
          >
            {t("systemlog.btn_reset")}
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors text-primary-foreground"
            style={{ background: "hsl(var(--primary))" }}
            data-testid="button-filter"
          >
            {t("systemlog.btn_filter")}
          </button>
        </div>
      </form>

      {activeFilters.analysisId && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {filteredAnalysisDomain
              ? t("systemlog.filtered_by_analysis_domain", {
                  id: activeFilters.analysisId.slice(0, 8),
                  domain: filteredAnalysisDomain,
                })
              : t("systemlog.filtered_by_analysis", { id: activeFilters.analysisId.slice(0, 8) })}
          </span>
          <button
            type="button"
            onClick={showAllEvents}
            className="text-primary hover:underline"
            data-testid="button-show-all-events"
          >
            {t("systemlog.show_all")}
          </button>
        </div>
      )}

      <div className="rounded-xl overflow-hidden mt-6" style={cardStyle}>
        {error && (
          <div className="p-4 text-sm text-amber-400 border-b border-border/50">
            {error}
          </div>
        )}
        {isLoading && events.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("systemlog.loading")}
          </div>
        )}
        {!isLoading && events.length === 0 && !error && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {activeFilters.analysisId
              ? t("systemlog.no_events_for_analysis")
              : t("systemlog.empty")}
          </div>
        )}

        {events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid hsl(var(--border))",
                    background: "hsl(var(--muted) / 0.5)",
                  }}
                >
                  <th
                    className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {t("systemlog.col_time")}
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {t("systemlog.col_level")}
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium text-xs"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {t("systemlog.col_message")}
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {t("systemlog.col_analysis")}
                  </th>
                  <th
                    className="px-4 py-3 text-right font-medium text-xs whitespace-nowrap"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {t("systemlog.show_context")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => {
                  const hasContext = ev.context && Object.keys(ev.context).length > 0;
                  const isExpanded = expandedContexts[ev.id] && hasContext;
                  const isLastItem = i === events.length - 1;

                  return (
                    <Fragment key={ev.id}>
                      <tr
                        style={{
                          borderBottom:
                            !isExpanded && !isLastItem
                              ? "1px solid hsl(var(--border) / 0.5)"
                              : undefined,
                        }}
                      >
                        <td
                          className="px-4 py-3 whitespace-nowrap text-xs"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                        >
                          {formatTimestampSeconds(ev.createdAt, intlLocale)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <LevelBadge level={ev.level} t={t} />
                        </td>
                        <td className="px-4 py-3 max-w-md">
                          <span
                            className="text-sm font-medium"
                            style={{ color: "hsl(var(--foreground))" }}
                          >
                            {ev.msg}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {ev.analysisId ? (
                            <button
                              onClick={() => handleAnalysisClick(ev.analysisId!)}
                              className="text-xs font-mono transition-colors hover:underline"
                              style={{ color: "hsl(var(--primary))" }}
                              data-testid={`link-analysis-${ev.analysisId}`}
                            >
                              <span>{ev.analysisId.slice(0, 8)}</span>
                              {ev.analysisDomain && (
                                <span className="ml-1 text-muted-foreground">
                                  · {ev.analysisDomain}
                                </span>
                              )}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">–</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {hasContext ? (
                            <button
                              onClick={() => toggleContext(ev.id)}
                              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded transition-colors"
                              style={{
                                background: "hsl(var(--muted))",
                                color: "hsl(var(--foreground))",
                              }}
                              data-testid={`button-context-${ev.id}`}
                            >
                              {expandedContexts[ev.id] ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                              {expandedContexts[ev.id]
                                ? t("systemlog.hide_context")
                                : t("systemlog.show_context")}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">–</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr
                          style={{
                            borderBottom: !isLastItem
                              ? "1px solid hsl(var(--border) / 0.5)"
                              : undefined,
                            background: "hsl(var(--muted) / 0.2)",
                          }}
                        >
                          <td colSpan={5} className="px-4 py-3">
                            <pre
                              className="text-xs font-mono p-3 rounded-lg overflow-auto max-h-64 whitespace-pre"
                              style={{
                                background: "hsl(var(--input))",
                                border: "1px solid hsl(var(--border))",
                                color: "hsl(var(--foreground))",
                              }}
                              data-testid={`pre-context-${ev.id}`}
                            >
                              {JSON.stringify(ev.context, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nextBeforeId && (
        <div className="flex justify-center mt-6">
          <button
            onClick={() => fetchLogs(true, nextBeforeId)}
            disabled={isLoading || isAppending}
            className="px-6 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50 text-primary-foreground"
            style={{ background: "hsl(var(--primary))" }}
            data-testid="button-load-more"
          >
            {isAppending ? t("systemlog.loading") : t("systemlog.load_more")}
          </button>
        </div>
      )}
    </div>
  );
}
