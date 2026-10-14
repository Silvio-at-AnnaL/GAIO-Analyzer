import { useState, useEffect, useCallback, useRef } from "react";
import { Download, Trash2, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import type { ReportDeliveryItem, ReportDeliveryPage } from "@workspace/api-client-react";
import { adminFetch, useAuth, canAccess } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { useT, useLabelContext } from "@/lib/LabelProvider";

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
  return d.toLocaleString(locale, { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusKey(status: string): { key: string; bg: string; fg: string } {
  if (status === "sent") return { key: "deliverylog.status_delivered", bg: "#1e3a5f", fg: "#93c5fd" };
  if (status === "failed") return { key: "deliverylog.status_failed", bg: "#78350f", fg: "#fcd34d" };
  if (status === "not_configured")
    return { key: "deliverylog.status_no_mailserver", bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" };
  return { key: "deliverylog.status_unknown", bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" };
}

export function DeliveryLogView() {
  const t = useT();
  const { locale } = useLabelContext();
  const intlLocale = locale === "en" ? "en-US" : "de-DE";
  const { user, isAuthenticated, isLoading, permissions } = useAuth();
  const { setActiveView } = useAppStore();

  const allowed = isAuthenticated && !!user && canAccess("versandprotokoll", user.role, permissions);
  const sessionKey = user ? `${user.id}:${user.role}` : "";

  const [data, setData] = useState<ReportDeliveryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [consentOnly, setConsentOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [deleteTarget, setDeleteTarget] = useState<ReportDeliveryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const generation = useRef(0);
  const reqId = useRef(0);

  // Session change: drop everything and invalidate in-flight requests.
  useEffect(() => {
    generation.current += 1;
    reqId.current += 1;
    setData(null); setError(null); setActionError(null); setLoading(false);
    setDeleteTarget(null); setDeleting(false); setDownloading(null); setExporting(false);
    setSearch(""); setDebouncedSearch(""); setConsentOnly(false); setPage(1);
    return () => { generation.current += 1; reqId.current += 1; };
  }, [sessionKey, allowed]);

  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  const fetchLog = useCallback(async () => {
    if (!allowed) return;
    const gen = generation.current;
    const id = ++reqId.current;
    setLoading(true); setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (consentOnly) params.set("consent", "only");
    try {
      const res = await adminFetch(`/api/admin/report-deliveries?${params}`);
      if (gen !== generation.current || id !== reqId.current) return;
      if (!res.ok) { setError(t("deliverylog.load_error")); return; }
      const json = await res.json() as ReportDeliveryPage;
      if (gen !== generation.current || id !== reqId.current) return;
      if (json.pages > 0 && page > json.pages) { setPage(json.pages); return; }
      setData(json);
    } catch {
      if (gen === generation.current && id === reqId.current) setError(t("deliverylog.network_error"));
    } finally {
      if (gen === generation.current && id === reqId.current) setLoading(false);
    }
  }, [allowed, sessionKey, page, limit, debouncedSearch, consentOnly, t]);

  useEffect(() => { void fetchLog(); }, [fetchLog]);

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    a.click(); URL.revokeObjectURL(url);
  }

  function filenameFrom(res: Response, fallback: string): string {
    const m = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "");
    return m?.[1] ?? fallback;
  }

  async function exportCsv() {
    const gen = generation.current;
    setExporting(true); setActionError(null);
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (consentOnly) params.set("consent", "only");
    try {
      const res = await adminFetch(`/api/admin/report-deliveries/export.csv?${params}`);
      if (gen !== generation.current) return;
      if (!res.ok) { setActionError(t("deliverylog.csv_error")); return; }
      const blob = await res.blob();
      if (gen !== generation.current) return;
      saveBlob(blob, filenameFrom(res, `versandprotokoll_${new Date().toISOString().slice(0, 10)}.csv`));
    } catch {
      if (gen === generation.current) setActionError(t("deliverylog.csv_error"));
    } finally {
      if (gen === generation.current) setExporting(false);
    }
  }

  async function downloadReport(item: ReportDeliveryItem) {
    const gen = generation.current;
    setDownloading(item.id); setActionError(null);
    try {
      const res = await adminFetch(`/api/admin/report-deliveries/${item.id}/report`);
      if (gen !== generation.current) return;
      if (!res.ok) { setActionError(t("deliverylog.report_error")); return; }
      const html = await res.text();
      if (gen !== generation.current) return;
      const domain = (item.domain ?? "").replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);
      const date = String(item.createdAt).slice(0, 10).replace(/-/g, "");
      saveBlob(new Blob([html], { type: "text/html" }), filenameFrom(res, `GAIO-${domain}-${date}.html`));
    } catch {
      if (gen === generation.current) setActionError(t("deliverylog.report_error"));
    } finally {
      if (gen === generation.current) setDownloading(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const gen = generation.current;
    const target = deleteTarget;
    setDeleting(true); setActionError(null);
    try {
      const res = await adminFetch(`/api/admin/report-deliveries/${target.id}`, { method: "DELETE" });
      if (gen !== generation.current) return;
      if (res.ok || res.status === 404) {
        setDeleteTarget(null);
        if (data && data.items.length <= 1 && page > 1) setPage(page - 1);
        else await fetchLog();
      } else {
        setActionError(t("deliverylog.delete_error"));
      }
    } catch {
      if (gen === generation.current) setActionError(t("deliverylog.delete_error"));
    } finally {
      if (gen === generation.current) setDeleting(false);
    }
  }

  if (isLoading) return <div className="p-8 text-muted-foreground text-sm">{t("deliverylog.loading")}</div>;
  if (!allowed) {
    return (
      <div className="max-w-md mx-auto mt-16 space-y-4" data-testid="deliverylog-no-access">
        <p className="text-muted-foreground">{t("deliverylog.no_access")}</p>
        {!isAuthenticated && (
          <button className="text-sm underline text-primary" onClick={() => setActiveView(7)}>{t("deliverylog.go_to_login")}</button>
        )}
      </div>
    );
  }

  const cardStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" };
  const inputStyle = { background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" };
  const filtered = !!debouncedSearch || consentOnly;
  const columns = [
    ["datetime", "deliverylog.col_datetime"], ["email", "deliverylog.col_email"], ["company", "deliverylog.col_company"],
    ["score", "deliverylog.col_score"], ["type", "deliverylog.col_type"], ["consent", "deliverylog.col_consent"],
    ["status", "deliverylog.col_status"], ["report", "deliverylog.col_report"], ["actions", "deliverylog.col_actions"],
  ] as const;

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Inbox className="w-6 h-6" />{t("nav.admin_versandprotokoll")}</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-0.5" data-testid="deliverylog-count">
              {data.total === 1 ? t("deliverylog.count_one", { count: data.total }) : t("deliverylog.count_many", { count: data.total })}
            </p>
          )}
        </div>
        <button
          onClick={exportCsv}
          disabled={exporting}
          data-testid="button-export-csv"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm disabled:opacity-60"
          style={{ border: "1px solid hsl(var(--border))" }}>
          <Download className="w-4 h-4" />
          {exporting ? t("deliverylog.csv_exporting") : t("deliverylog.csv_export")}
        </button>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <input
          type="text"
          data-testid="input-search"
          aria-label={t("deliverylog.search_aria")}
          placeholder={t("deliverylog.search_placeholder")}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-48 px-3 py-2 rounded-lg text-sm"
          style={inputStyle}
        />
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            data-testid="toggle-consent-only"
            checked={consentOnly}
            onChange={e => { setConsentOnly(e.target.checked); setPage(1); }}
          />
          {t("deliverylog.consent_only")}
        </label>
      </div>

      {actionError && <div className="text-sm text-amber-400" role="alert" data-testid="deliverylog-action-error">{actionError}</div>}

      <div className="rounded-xl overflow-hidden" style={cardStyle}>
        {error && (
          <div className="p-4 text-sm text-amber-400 flex items-center gap-3" role="alert" data-testid="deliverylog-error">
            <span>{error}</span>
            <button className="underline" onClick={() => void fetchLog()}>{t("deliverylog.retry")}</button>
          </div>
        )}
        {loading && !data && !error && (
          <div className="p-8 text-center text-sm text-muted-foreground">{t("deliverylog.loading")}</div>
        )}
        {!loading && !error && data?.items.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground" data-testid="deliverylog-empty">
            {filtered ? t("deliverylog.empty_filtered") : t("deliverylog.empty_none")}
          </div>
        )}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                  {columns.map(([id, key]) => (
                    <th key={id} className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap" style={{ color: "hsl(var(--muted-foreground))" }}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, i) => {
                  const st = statusKey(item.status);
                  return (
                    <tr key={item.id} data-testid={`row-delivery-${item.id}`} style={{ borderBottom: i < data.items.length - 1 ? "1px solid hsl(var(--border) / 0.5)" : undefined }}>
                      <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {formatTimestamp(item.createdAt, intlLocale)}
                      </td>
                      <td className="px-4 py-3 text-xs break-all max-w-[14rem]">{item.recipientEmail}</td>
                      <td className="px-4 py-3 max-w-xs">
                        {item.companyName && <p className="text-xs mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{item.companyName}</p>}
                        <span className="text-xs font-medium break-all">{item.domain}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.gaioScore !== null
                          ? <span className="text-base font-bold" style={{ color: scoreColor(item.gaioScore) }}>{item.gaioScore}</span>
                          : <span className="text-muted-foreground">–</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {item.reportType === "pdf" ? t("deliverylog.type_pdf") : item.reportType === "html" ? t("deliverylog.type_html") : (item.reportType ?? "–")}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {item.consentMarketing ? (
                          <span className="cursor-help" title={item.consentText ?? t("deliverylog.consent_text_missing")}>
                            {item.consentAt
                              ? t("deliverylog.consent_yes_date", { date: formatTimestamp(item.consentAt, intlLocale) })
                              : t("deliverylog.consent_yes")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t("deliverylog.consent_no")}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          title={item.errorMessage ?? undefined}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${item.errorMessage ? "cursor-help" : ""}`}
                          style={{ background: st.bg, color: st.fg }}>
                          {t(st.key)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.hasReport ? (
                          <button
                            onClick={() => downloadReport(item)}
                            disabled={downloading === item.id}
                            data-testid={`button-report-${item.id}`}
                            title={t("deliverylog.report_download")}
                            aria-label={t("deliverylog.report_download")}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors disabled:opacity-50"
                            style={{ border: "1px solid hsl(var(--border))" }}>
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        ) : <span className="text-muted-foreground text-sm">–</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDeleteTarget(item)}
                          data-testid={`button-delete-${item.id}`}
                          title={t("deliverylog.delete_title")}
                          aria-label={t("deliverylog.delete_title")}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:text-amber-400"
                          style={{ border: "1px solid hsl(var(--border))" }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("deliverylog.pagination", { page: data.page, pages: data.pages })}</span>
            <select
              value={limit}
              aria-label={t("deliverylog.per_page_aria")}
              onChange={e => { setLimit(parseInt(e.target.value)); setPage(1); }}
              className="ml-2 px-2 py-1 rounded text-xs"
              style={inputStyle}>
              <option value="10">{t("deliverylog.per_page", { count: 10 })}</option>
              <option value="25">{t("deliverylog.per_page", { count: 25 })}</option>
              <option value="50">{t("deliverylog.per_page", { count: 50 })}</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              aria-label={t("deliverylog.prev_page")} title={t("deliverylog.prev_page")}
              className="p-1.5 rounded-md disabled:opacity-40" style={{ border: "1px solid hsl(var(--border))" }}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page >= data.pages}
              aria-label={t("deliverylog.next_page")} title={t("deliverylog.next_page")}
              className="p-1.5 rounded-md disabled:opacity-40" style={{ border: "1px solid hsl(var(--border))" }}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div role="dialog" aria-modal="true" className="rounded-xl p-6 max-w-sm w-full mx-4 space-y-4" style={cardStyle}>
            <h3 className="font-semibold text-base">{t("deliverylog.delete_title")}</h3>
            <p className="text-sm text-muted-foreground">{t("deliverylog.delete_confirm")}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} data-testid="button-delete-cancel"
                className="px-4 py-2 rounded-lg text-sm" style={{ border: "1px solid hsl(var(--border))" }}>
                {t("deliverylog.cancel")}
              </button>
              <button onClick={confirmDelete} disabled={deleting} data-testid="button-delete-confirm"
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                style={{ background: "#b45309", color: "white" }}>
                {deleting ? t("deliverylog.deleting") : t("deliverylog.delete_button")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
