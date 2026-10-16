import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Download, Coins } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { adminFetch, useAuth, canAccess } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { useT } from "@/lib/LabelProvider";
import { formatAdminCost, searchUsageLevel } from "@/lib/admin-usage";
import {
  presetRange, usageQuery, usageCsvFilename, chartData, sortByCost, areaLabel, moduleLabel, modelLabel,
  isPlainDate, type UsagePreset, type UsageEnv, type UsageGroupRow, type UsageDay, type ChartPoint,
} from "@/lib/usage-helpers";

interface Totals { inputTokens: number; outputTokens: number; costUsd: number | null; searchCredits: number; searchCostUsd: number | null }
interface UsageSummary {
  totals: Totals; analysesCount: number; avgCostPerAnalysis: number | null;
  byArea: (UsageGroupRow & { area: string })[];
  byModule: (UsageGroupRow & { module: string })[];
  byModel: (UsageGroupRow & { model: string | null })[];
  byDay: UsageDay[];
  searchMonth: { used: number; included: number; plan: string } | null;
}

const nf = new Intl.NumberFormat("de-DE");
const cardStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" };
const inputStyle = { background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" };
const PRESETS: [UsagePreset, string][] = [
  ["today", "usage.preset_today"], ["last7", "usage.preset_last7"], ["last30", "usage.preset_last30"],
  ["month", "usage.preset_month"], ["prevMonth", "usage.preset_prev_month"], ["custom", "usage.preset_custom"],
];
const ENVS: [UsageEnv, string][] = [["live", "usage.env_live"], ["dev", "usage.env_dev"], ["all", "usage.env_all"]];

function Tile({ id, label, value, sub }: { id: string; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-4" style={cardStyle} data-testid={`tile-${id}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export function UsageView() {
  const t = useT();
  const { user, isAuthenticated, isLoading, permissions } = useAuth();
  const { setActiveView } = useAppStore();
  const allowed = isAuthenticated && !!user && canAccess("kosten", user.role, permissions);
  const sessionKey = user ? `${user.id}:${user.role}` : "";

  const [preset, setPreset] = useState<UsagePreset>("last30");
  const [customFrom, setCustomFrom] = useState(() => presetRange("last30", new Date()).from);
  const [customTo, setCustomTo] = useState(() => presetRange("last30", new Date()).to);
  const [env, setEnv] = useState<UsageEnv>("live");
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const generation = useRef(0);
  const reqId = useRef(0);

  const range = useMemo(
    () => preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset, new Date()),
    [preset, customFrom, customTo],
  );
  const rangeValid = isPlainDate(range.from) && isPlainDate(range.to) && range.from <= range.to;

  useEffect(() => {
    generation.current += 1; reqId.current += 1;
    setData(null); setError(null); setActionError(null); setLoading(false); setExporting(false);
    return () => { generation.current += 1; reqId.current += 1; };
  }, [sessionKey, allowed]);

  const fetchUsage = useCallback(async () => {
    if (!allowed || !rangeValid) return;
    const gen = generation.current;
    const id = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const res = await adminFetch(`/api/admin/usage/summary?${usageQuery(range.from, range.to, env)}`);
      if (gen !== generation.current || id !== reqId.current) return;
      if (!res.ok) { setError(t("usage.load_error")); return; }
      const json = await res.json() as UsageSummary;
      if (gen !== generation.current || id !== reqId.current) return;
      setData(json);
    } catch {
      if (gen === generation.current && id === reqId.current) setError(t("usage.network_error"));
    } finally {
      if (gen === generation.current && id === reqId.current) setLoading(false);
    }
  }, [allowed, sessionKey, range.from, range.to, rangeValid, env, t]);

  useEffect(() => { void fetchUsage(); }, [fetchUsage]);

  async function exportCsv() {
    const gen = generation.current;
    setExporting(true); setActionError(null);
    try {
      const res = await adminFetch(`/api/admin/usage/export.csv?${usageQuery(range.from, range.to, env)}`);
      if (gen !== generation.current) return;
      if (!res.ok) { setActionError(t("usage.csv_error")); return; }
      const blob = await res.blob();
      if (gen !== generation.current) return;
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = usageCsvFilename(range.from, range.to, env);
        document.body.appendChild(link);
        try {
          link.click();
        } finally {
          link.remove();
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      if (gen === generation.current) setActionError(t("usage.csv_error"));
    } finally {
      if (gen === generation.current) setExporting(false);
    }
  }

  const points = useMemo<ChartPoint[]>(() => data ? chartData(data.byDay ?? [], range.from, range.to) : [], [data, range.from, range.to]);

  if (isLoading) return <div className="p-8 text-muted-foreground text-sm">{t("usage.loading")}</div>;
  if (!allowed) {
    return (
      <div className="max-w-md mx-auto mt-16 space-y-4" data-testid="usage-no-access">
        <p className="text-muted-foreground">{t("usage.no_access")}</p>
        {!isAuthenticated && (
          <button data-testid="button-go-to-login" className="text-sm underline text-primary" onClick={() => setActiveView(7)}>{t("usage.go_to_login")}</button>
        )}
      </div>
    );
  }

  const cost = (v: number | null) => formatAdminCost(v, t);
  const isEmpty = !!data && data.totals.costUsd == null
    ? data.byArea.length === 0 && data.totals.searchCredits === 0
    : !!data && (data.totals.costUsd ?? 0) === 0 && data.byArea.length === 0 && data.totals.searchCredits === 0;
  const sm = data?.searchMonth;
  const level = sm ? searchUsageLevel(sm.used, sm.included) : "normal";

  function table(id: string, title: string, firstCol: string, rows: { key: string; label: string; row: UsageGroupRow }[]) {
    const cols = ["usage.col_llm_calls", "usage.col_search_calls", "usage.col_tokens_in", "usage.col_tokens_out", "usage.col_credits", "usage.col_cost"];
    const sorted = sortByCost(rows.map(r => ({ ...r, costUsd: r.row.costUsd })));
    return (
      <section className="rounded-xl overflow-hidden" style={cardStyle} data-testid={`table-${id}`}>
        <h2 className="px-4 py-3 text-sm font-semibold">{title}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderTop: "1px solid hsl(var(--border))", borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                <th className="px-4 py-2 text-left font-medium text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{firstCol}</th>
                {cols.map(c => <th key={c} className="px-4 py-2 text-right font-medium text-xs whitespace-nowrap" style={{ color: "hsl(var(--muted-foreground))" }}>{t(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.key} data-testid={`row-${id}-${r.key}`} style={{ borderBottom: i < sorted.length - 1 ? "1px solid hsl(var(--border) / 0.5)" : undefined }}>
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nf.format(r.row.llmCalls)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nf.format(r.row.searchCalls)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nf.format(r.row.inputTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nf.format(r.row.outputTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nf.format(r.row.searchCredits)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{cost(r.row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Coins className="w-6 h-6" />{t("usage.title")}</h1>
        <button onClick={exportCsv} disabled={exporting || !rangeValid} data-testid="button-export-csv"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm disabled:opacity-60"
          style={{ border: "1px solid hsl(var(--border))" }}>
          <Download className="w-4 h-4" />
          {exporting ? t("usage.csv_exporting") : t("usage.csv_export")}
        </button>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <select value={preset} onChange={e => setPreset(e.target.value as UsagePreset)} aria-label={t("usage.period_aria")}
          data-testid="select-period" className="px-3 py-2 rounded-lg text-sm" style={inputStyle}>
          {PRESETS.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
        </select>
        {preset === "custom" && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} aria-label={t("usage.from_aria")}
              data-testid="input-from" className="px-3 py-2 rounded-lg text-sm" style={inputStyle} />
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} aria-label={t("usage.to_aria")}
              data-testid="input-to" className="px-3 py-2 rounded-lg text-sm" style={inputStyle} />
          </>
        )}
        <select value={env} onChange={e => setEnv(e.target.value as UsageEnv)} aria-label={t("usage.env_aria")}
          data-testid="select-env" className="px-3 py-2 rounded-lg text-sm" style={inputStyle}>
          {ENVS.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
        </select>
      </div>

      {actionError && <div className="text-sm text-amber-400" role="alert" data-testid="usage-action-error">{actionError}</div>}

      {error && (
        <div className="rounded-xl p-4 text-sm text-amber-400 flex items-center gap-3" style={cardStyle} role="alert" data-testid="usage-error">
          <span>{error}</span>
          <button className="underline" onClick={() => void fetchUsage()} data-testid="button-retry">{t("usage.retry")}</button>
        </div>
      )}
      {loading && !data && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4" data-testid="usage-loading" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="rounded-xl h-24 animate-pulse" style={cardStyle} />)}
        </div>
      )}

      {data && !error && (
        <div className="space-y-6" style={{ opacity: loading ? 0.6 : 1 }}>
          {isEmpty ? (
            <div className="rounded-xl p-12 text-center text-sm text-muted-foreground" style={cardStyle} data-testid="usage-empty">
              {t("usage.empty")}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <Tile id="cost" label={t("usage.tile_cost")} value={cost(data.totals.costUsd)} />
                <Tile id="analyses" label={t("usage.tile_analyses")} value={nf.format(data.analysesCount)}
                  sub={`${t("usage.tile_avg")}: ${cost(data.avgCostPerAnalysis)}`} />
                <Tile id="tokens-in" label={t("usage.tile_tokens_in")} value={nf.format(data.totals.inputTokens)} />
                <Tile id="tokens-out" label={t("usage.tile_tokens_out")} value={nf.format(data.totals.outputTokens)} />
                <Tile id="search" label={t("usage.tile_search")}
                  value={t("usage.tile_search_credits", { credits: nf.format(data.totals.searchCredits) })}
                  sub={data.totals.searchCostUsd != null ? t("usage.tile_search_cost", { cost: cost(data.totals.searchCostUsd) }) : undefined} />
              </div>

              <section className="rounded-xl p-4" style={cardStyle} data-testid="usage-chart">
                <h2 className="text-sm font-semibold mb-3">{t("usage.chart_title")}</h2>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={points}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`} />
                      <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v: number) => cost(v)} />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as ChartPoint;
                        return (
                          <div className="rounded-lg p-2 text-xs space-y-0.5" style={cardStyle}>
                            <p className="font-medium">{p.day}</p>
                            <p>{t("usage.chart_cost")}: {cost(p.costUsd)}</p>
                            <p>{t("usage.chart_tokens")}: {nf.format(p.inputTokens)} / {nf.format(p.outputTokens)}</p>
                            <p>{t("usage.chart_analyses")}: {nf.format(p.analyses)}</p>
                          </div>
                        );
                      }} />
                      <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {table("area", t("usage.by_area"), t("usage.col_area"),
                data.byArea.map(r => ({ key: r.area, label: areaLabel(r.area, t), row: r })))}
              {table("module", t("usage.by_module"), t("usage.col_module"),
                data.byModule.map(r => ({ key: r.module, label: moduleLabel(r.module, t), row: r })))}
              {table("model", t("usage.by_model"), t("usage.col_model"),
                data.byModel.map(r => ({ key: r.model ?? "__search", label: modelLabel(r.model, t), row: r })))}
            </>
          )}

          {sm && (
            <div data-testid="text-tavily-usage" data-level={level}
              className={`text-sm ${level === "red" ? "text-red-500" : level === "amber" ? "text-amber-500" : "text-muted-foreground"}`}>
              <p>{t("ai.search_month_usage", { used: nf.format(sm.used), included: nf.format(sm.included) })} {t("usage.plan_suffix", { plan: sm.plan })}</p>
              {level === "red" && <p>{t("ai.search_quota_exhausted")}</p>}
            </div>
          )}
          <p className="text-xs text-muted-foreground" data-testid="usage-footnote">{t("usage.footnote")}</p>
        </div>
      )}
    </div>
  );
}
