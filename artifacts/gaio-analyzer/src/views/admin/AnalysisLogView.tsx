import { useState, useEffect, useCallback, useRef } from "react";
import { Download, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { adminFetch } from "@/store/authStore";
import { useAuth } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { useT, useLabelContext } from "@/lib/LabelProvider";

interface LogItem {
  id: number;
  domain: string;
  companyName: string | null;
  triggeredBy: string | null;
  gaioScore: number | null;
  scoresJson: string | null;
  pagesCrawled: number | null;
  status: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  hasHtmlExport: boolean;
}

interface LogResponse {
  items: LogItem[];
  total: number;
  page: number;
  pages: number;
  storageTotalKb: number;
}

function scoreColor(score: number | null): string {
  if (score === null) return "hsl(var(--muted-foreground))";
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function formatTimestamp(value: string | Date | null | undefined, locale: string): string {
  if (!value) return "–";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleString(locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StorageDisplay({ kb }: { kb: number }) {
  if (kb < 1024) return <span>{kb} KB</span>;
  return <span>{(kb / 1024).toFixed(1)} MB</span>;
}

export function AnalysisLogView() {
  const t = useT();
  const { locale } = useLabelContext();
  const intlLocale = locale === "en" ? "en-US" : "de-DE";
  const { user, isAuthenticated, isLoading } = useAuth();
  const { setActiveView } = useAppStore();

  const [data, setData] = useState<LogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [deleteTarget, setDeleteTarget] = useState<LogItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search]);

  const fetchLog = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (statusFilter) params.set("status", statusFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    try {
      const res = await adminFetch(`/api/admin/analysis-log?${params}`);
      if (!res.ok) { setError(t("log.load_error")); return; }
      setData(await res.json() as LogResponse);
    } catch {
      setError(t("log.network_error"));
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, debouncedSearch, t]);

  useEffect(() => { if (isAuthenticated && user?.role === "admin") fetchLog(); }, [fetchLog, isAuthenticated, user]);

  async function downloadExport(item: LogItem) {
    setDownloading(item.id);
    try {
      const res = await adminFetch(`/api/admin/analysis-log/${item.id}/export`);
      if (!res.ok) { alert(t("log.export_unavailable")); return; }
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = item.startedAt.slice(0, 10).replace(/-/g, "");
      const domain = item.domain.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);
      a.href = url; a.download = `GAIO-${domain}-${date}.html`;
      a.click(); URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/analysis-log/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) { setDeleteTarget(null); await fetchLog(); }
      else alert(t("users.delete_error"));
    } finally {
      setDeleting(false);
    }
  }

  if (isLoading) return <div className="p-8 text-muted-foreground text-sm">{t("profile.loading")}</div>;
  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="max-w-md mx-auto mt-16 space-y-4">
        <p className="text-muted-foreground">{t("log.no_access")}</p>
        <button className="text-sm underline text-primary" onClick={() => setActiveView(7)}>{t("auth.go_to_login_button")}</button>
      </div>
    );
  }

  const cardStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.admin_analyseprotokoll")}</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {data.total === 1
                ? t("log.count_one",  { count: data.total })
                : t("log.count_many", { count: data.total })}
              {data.storageTotalKb > 0 && (
                <> · {t("log.storage_saved")} <StorageDisplay kb={data.storageTotalKb} /></>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder={t("log.search_placeholder")}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-48 px-3 py-2 rounded-lg text-sm"
          style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg text-sm"
          style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
        >
          <option value="">{t("log.filter_all")}</option>
          <option value="completed">{t("log.status_completed")}</option>
          <option value="failed">{t("log.status_failed")}</option>
          <option value="running">{t("log.status_running")}</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={cardStyle}>
        {error && (
          <div className="p-4 text-sm text-amber-400">{error}</div>
        )}
        {loading && !data && (
          <div className="p-8 text-center text-sm text-muted-foreground">{t("prompts.loading")}</div>
        )}
        {!loading && data?.items.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {debouncedSearch || statusFilter ? t("log.empty_search") : t("log.empty_none")}
          </div>
        )}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                  {[
                    { id: "datetime",  label: t("log.col_datetime") },
                    { id: "company",   label: t("log.col_company") },
                    { id: "score",     label: t("log.col_score") },
                    { id: "pages",     label: t("log.col_pages") },
                    { id: "status",    label: t("users.col_status") },
                    { id: "export",    label: t("log.col_export") },
                    { id: "actions",   label: t("users.col_actions") },
                  ].map(({ id, label }) => (
                    <th key={id} className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: i < data.items.length - 1 ? "1px solid hsl(var(--border) / 0.5)" : undefined }}>
                    {/* Datum */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {formatTimestamp(item.startedAt, intlLocale)}
                    </td>

                    {/* Unternehmen / Domain */}
                    <td className="px-4 py-3 max-w-xs">
                      {item.companyName && (
                        <p className="text-xs mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{item.companyName}</p>
                      )}
                      {item.domain.startsWith("http") ? (
                        <a href={item.domain} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-medium truncate block hover:underline"
                          style={{ color: "hsl(var(--primary))", maxWidth: 220 }}>
                          {item.domain}
                        </a>
                      ) : (
                        <span className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>{item.domain}</span>
                      )}
                    </td>

                    {/* GAIO Score */}
                    <td className="px-4 py-3 text-center">
                      {item.gaioScore !== null ? (
                        <span className="text-base font-bold" style={{ color: scoreColor(item.gaioScore) }}>
                          {item.gaioScore}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>

                    {/* Seiten */}
                    <td className="px-4 py-3 text-center text-sm">
                      {item.pagesCrawled ?? <span className="text-muted-foreground">–</span>}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {item.status === "completed" && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: "#1e3a5f", color: "#93c5fd" }}>
                          {t("log.status_completed")}
                        </span>
                      )}
                      {item.status === "failed" && (
                        <span
                          title={item.errorMessage ?? undefined}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-help"
                          style={{ background: "#78350f", color: "#fcd34d" }}>
                          ⚠ {t("log.status_failed")}
                        </span>
                      )}
                      {item.status === "running" && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                          {t("log.status_running_loading")}
                        </span>
                      )}
                    </td>

                    {/* HTML Export */}
                    <td className="px-4 py-3 text-center">
                      {item.hasHtmlExport ? (
                        <button
                          onClick={() => downloadExport(item)}
                          disabled={downloading === item.id}
                          title={t("log.export_title")}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors disabled:opacity-50"
                          style={{ border: "1px solid hsl(var(--border))" }}>
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-sm">–</span>
                      )}
                    </td>

                    {/* Aktionen */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDeleteTarget(item)}
                        title={t("log.delete_title")}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:text-amber-400"
                        style={{ border: "1px solid hsl(var(--border))" }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("log.pagination", { page: data.page, pages: data.pages })}</span>
            <select
              value={limit}
              onChange={e => { setLimit(parseInt(e.target.value)); setPage(1); }}
              className="ml-2 px-2 py-1 rounded text-xs"
              style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              <option value="10">{t("log.per_page", { count: 10 })}</option>
              <option value="25">{t("log.per_page", { count: 25 })}</option>
              <option value="50">{t("log.per_page", { count: 50 })}</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded-md disabled:opacity-40"
              style={{ border: "1px solid hsl(var(--border))" }}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages}
              className="p-1.5 rounded-md disabled:opacity-40"
              style={{ border: "1px solid hsl(var(--border))" }}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="rounded-xl p-6 max-w-sm w-full mx-4 space-y-4" style={cardStyle}>
            <h3 className="font-semibold text-base">{t("log.delete_confirm_title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("log.delete_confirm_pre")}
              <strong>{deleteTarget.companyName || deleteTarget.domain}</strong>
              {t("log.delete_confirm_post", { date: formatTimestamp(deleteTarget.startedAt, intlLocale) })}
              {deleteTarget.hasHtmlExport && t("log.delete_confirm_html")}
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ border: "1px solid hsl(var(--border))" }}>
                {t("domain.aria_cancel")}
              </button>
              <button onClick={confirmDelete} disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                style={{ background: "#b45309", color: "white" }}>
                {deleting ? t("log.deleting") : t("log.delete_button")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
