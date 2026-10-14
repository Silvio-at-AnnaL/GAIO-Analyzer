import { useState, useEffect, useCallback, useRef } from "react";
import { FilterX, Pencil, Trash2, Check, X } from "lucide-react";
import { adminFetch, useAuth, canAccess } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { useT } from "@/lib/LabelProvider";

interface Rule { id: number; pattern: string; is_active: boolean; count_in_report: boolean; note: string | null; created_at: string; updated_at: string }
interface TestResult { excluded: boolean; countedInReport: boolean; matches: { id: number; pattern: string; is_active: boolean; count_in_report: boolean }[] }
interface Draft { pattern: string; note: string }

const BASE = "/api/admin/crawl-exclusions";
const JSON_HEADERS = { "Content-Type": "application/json" };

function fmt(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function errText(res: Response, fallback: string): Promise<string> {
  try { const j = await res.json() as { error?: string }; return j.error || fallback; } catch { return fallback; }
}

export function CrawlExclusionsView() {
  const t = useT();
  const { user, isAuthenticated, isLoading, permissions } = useAuth();
  const { setActiveView } = useAppStore();
  const allowed = isAuthenticated && !!user && canAccess("crawl_ausschluesse", user.role, permissions);
  const sessionKey = user ? `${user.id}:${user.role}` : "";

  const [rules, setRules] = useState<Rule[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [newPattern, setNewPattern] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newActive, setNewActive] = useState(true);
  const [newCounted, setNewCounted] = useState(true);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [testUrl, setTestUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const generation = useRef(0);
  const reqId = useRef(0);

  useEffect(() => {
    generation.current += 1; reqId.current += 1;
    setRules(null); setError(null); setLoading(false); setDrafts({}); setRowErrors({}); setBusy({});
    setSearch(""); setTestResult(null); setTestError(null); setDeleteTarget(null); setAddError(null);
    setNewPattern(""); setNewNote(""); setNewActive(true); setNewCounted(true);
    setAdding(false); setTesting(false); setTestUrl(""); setDeleting(false); setDeleteError(null);
    return () => { generation.current += 1; reqId.current += 1; };
  }, [sessionKey, allowed]);

  const load = useCallback(async () => {
    if (!allowed) return;
    const gen = generation.current;
    const id = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const res = await adminFetch(BASE);
      if (gen !== generation.current || id !== reqId.current) return;
      if (!res.ok) { setError(t("exclusions.load_error")); return; }
      const json = await res.json() as Rule[];
      if (gen !== generation.current || id !== reqId.current) return;
      setRules(json);
    } catch {
      if (gen === generation.current && id === reqId.current) setError(t("exclusions.network_error"));
    } finally {
      if (gen === generation.current && id === reqId.current) setLoading(false);
    }
  }, [allowed, sessionKey, t]);

  useEffect(() => { void load(); }, [load]);

  const setRowBusy = (id: number, v: boolean) => setBusy(b => ({ ...b, [id]: v }));
  const setRowError = (id: number, msg: string | null) => setRowErrors(e => {
    const n = { ...e }; if (msg) n[id] = msg; else delete n[id]; return n;
  });

  async function patch(rule: Rule, body: Record<string, unknown>, onOk?: () => void) {
    const gen = generation.current;
    setRowBusy(rule.id, true); setRowError(rule.id, null);
    try {
      const res = await adminFetch(`${BASE}/${rule.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
      if (gen !== generation.current) return;
      if (!res.ok) { setRowError(rule.id, await errText(res, t("exclusions.save_error"))); return; }
      onOk?.();
      await load();
    } catch {
      if (gen === generation.current) setRowError(rule.id, t("exclusions.network_error"));
    } finally {
      if (gen === generation.current) setRowBusy(rule.id, false);
    }
  }

  function saveDraft(rule: Rule) {
    const d = drafts[rule.id];
    if (!d) return;
    void patch(rule, { pattern: d.pattern, note: d.note }, () =>
      setDrafts(prev => { const n = { ...prev }; delete n[rule.id]; return n; }));
  }

  function cancelDraft(id: number) {
    setDrafts(prev => { const n = { ...prev }; delete n[id]; return n; });
    setRowError(id, null);
  }

  async function addRule() {
    const gen = generation.current;
    setAdding(true); setAddError(null);
    try {
      const res = await adminFetch(BASE, {
        method: "POST", headers: JSON_HEADERS,
        body: JSON.stringify({ pattern: newPattern, note: newNote, is_active: newActive, count_in_report: newCounted }),
      });
      if (gen !== generation.current) return;
      if (!res.ok) { setAddError(await errText(res, t("exclusions.save_error"))); return; }
      setNewPattern(""); setNewNote(""); setNewActive(true); setNewCounted(true);
      await load();
    } catch {
      if (gen === generation.current) setAddError(t("exclusions.network_error"));
    } finally {
      if (gen === generation.current) setAdding(false);
    }
  }

  async function runTest() {
    const gen = generation.current;
    setTesting(true); setTestError(null); setTestResult(null);
    try {
      const res = await adminFetch(`${BASE}/test`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url: testUrl.trim() }) });
      if (gen !== generation.current) return;
      if (!res.ok) { setTestError(await errText(res, t("exclusions.test_error"))); return; }
      setTestResult(await res.json() as TestResult);
    } catch {
      if (gen === generation.current) setTestError(t("exclusions.test_error"));
    } finally {
      if (gen === generation.current) setTesting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const gen = generation.current;
    const target = deleteTarget;
    setDeleting(true); setDeleteError(null);
    try {
      const res = await adminFetch(`${BASE}/${target.id}`, { method: "DELETE" });
      if (gen !== generation.current) return;
      if (res.ok || res.status === 404) {
        setDeleteTarget(null);
        setDrafts(prev => { const n = { ...prev }; delete n[target.id]; return n; });
        await load();
      } else {
        setDeleteError(await errText(res, t("exclusions.save_error")));
      }
    } catch {
      if (gen === generation.current) setDeleteError(t("exclusions.network_error"));
    } finally {
      if (gen === generation.current) setDeleting(false);
    }
  }

  if (isLoading) return <div className="p-8 text-muted-foreground text-sm">{t("exclusions.loading")}</div>;
  if (!allowed) {
    return (
      <div className="max-w-md mx-auto mt-16 space-y-4" data-testid="exclusions-no-access">
        <p className="text-muted-foreground">{t("exclusions.no_access")}</p>
        {!isAuthenticated && <button className="text-sm underline text-primary" onClick={() => setActiveView(7)}>{t("exclusions.go_to_login")}</button>}
      </div>
    );
  }

  const cardStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" };
  const inputStyle = { background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" };
  const btnStyle = { border: "1px solid hsl(var(--border))" };
  const q = search.trim().toLowerCase();
  const all = rules ?? [];
  const visible = q ? all.filter(r => r.pattern.toLowerCase().includes(q) || (r.note ?? "").toLowerCase().includes(q)) : all;
  const activeCount = all.filter(r => r.is_active).length;
  const columns = ["col_pattern", "col_note", "col_active", "col_counted", "col_changed", "col_actions"] as const;
  const yn = (v: boolean) => t(v ? "exclusions.yes" : "exclusions.no");

  return (
    <div className="space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FilterX className="w-6 h-6" />{t("nav.admin_crawl_ausschluesse")}</h1>
        {rules && <p className="text-sm text-muted-foreground mt-0.5" data-testid="exclusions-count">{t("exclusions.count", { total: all.length, active: activeCount })}</p>}
      </div>

      <div className="rounded-xl p-4 space-y-2 text-sm" style={cardStyle} data-testid="exclusions-help">
        <h2 className="font-semibold">{t("exclusions.help_title")}</h2>
        <p>{t("exclusions.help_rule")}</p>
        <ul className="list-disc pl-5 text-muted-foreground font-mono text-xs space-y-0.5">
          <li>{t("exclusions.help_ex_cart")}</li>
          <li>{t("exclusions.help_ex_cart_star")}</li>
          <li>{t("exclusions.help_ex_star_cart_star")}</li>
          <li>{t("exclusions.help_ex_pdf")}</li>
        </ul>
        <p className="text-muted-foreground">{t("exclusions.help_notes")}</p>
        <p>{t("exclusions.help_apply")}</p>
        <p className="text-amber-400">{t("exclusions.help_shared")}</p>
      </div>

      <div className="rounded-xl p-4 space-y-3" style={cardStyle}>
        <h2 className="font-semibold text-sm">{t("exclusions.test_title")}</h2>
        <form data-testid="form-test" className="flex gap-2 flex-wrap" onSubmit={e => { e.preventDefault(); void runTest(); }}>
          <input type="text" data-testid="input-test-url" aria-label={t("exclusions.test_aria")} placeholder={t("exclusions.test_placeholder")}
            value={testUrl} onChange={e => setTestUrl(e.target.value)} className="flex-1 min-w-48 px-3 py-2 rounded-lg text-sm" style={inputStyle} />
          <button type="submit" data-testid="button-test" disabled={testing || !testUrl.trim()} className="px-4 py-2 rounded-lg text-sm disabled:opacity-60" style={btnStyle}>
            {testing ? t("exclusions.test_running") : t("exclusions.test_button")}
          </button>
        </form>
        {testError && <div className="text-sm text-amber-400" role="alert" data-testid="test-error">{testError}</div>}
        {testResult && (
          <div className="text-sm space-y-2" data-testid="test-result">
            <p data-testid="test-excluded">{t("exclusions.test_excluded", { value: yn(testResult.excluded) })}</p>
            <p data-testid="test-counted">{t("exclusions.test_counted", { value: yn(testResult.countedInReport) })}</p>
            <p className="text-xs text-muted-foreground">{t("exclusions.test_matches")}</p>
            {testResult.matches.length === 0
              ? <p className="text-muted-foreground" data-testid="test-no-matches">{t("exclusions.test_no_matches")}</p>
              : <ul className="space-y-1">{testResult.matches.map(m => (
                <li key={m.id} data-testid={`test-match-${m.id}`} className="flex items-center gap-2">
                  <code className="font-mono text-xs">{m.pattern}</code>
                  {!m.is_active && <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{t("exclusions.test_inactive")}</span>}
                </li>))}</ul>}
          </div>
        )}
      </div>

      <form data-testid="form-add" className="rounded-xl p-4 space-y-3" style={cardStyle} onSubmit={e => { e.preventDefault(); void addRule(); }}>
        <h2 className="font-semibold text-sm">{t("exclusions.add_title")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input type="text" data-testid="input-new-pattern" aria-label={t("exclusions.add_pattern")} placeholder={t("exclusions.add_pattern_placeholder")}
            value={newPattern} onChange={e => setNewPattern(e.target.value)} className="px-3 py-2 rounded-lg text-sm font-mono" style={inputStyle} />
          <input type="text" data-testid="input-new-note" aria-label={t("exclusions.add_note")} placeholder={t("exclusions.add_note_placeholder")}
            value={newNote} onChange={e => setNewNote(e.target.value)} className="px-3 py-2 rounded-lg text-sm" style={inputStyle} />
        </div>
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" data-testid="checkbox-new-active" checked={newActive} onChange={e => setNewActive(e.target.checked)} />{t("exclusions.add_active")}
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" data-testid="checkbox-new-counted" checked={newCounted} onChange={e => setNewCounted(e.target.checked)} />{t("exclusions.add_counted")}
          </label>
          <button type="submit" data-testid="button-add" disabled={adding || !newPattern.trim()} className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60" style={btnStyle}>
            {adding ? t("exclusions.adding") : t("exclusions.add_button")}
          </button>
        </div>
        {addError && <div className="text-sm text-amber-400" role="alert" data-testid="add-error">{addError}</div>}
      </form>

      <input type="text" data-testid="input-search" aria-label={t("exclusions.search_aria")} placeholder={t("exclusions.search_placeholder")}
        value={search} onChange={e => setSearch(e.target.value)} className="w-full max-w-md px-3 py-2 rounded-lg text-sm" style={inputStyle} />

      <div className="rounded-xl overflow-hidden" style={cardStyle}>
        {error && (
          <div className="p-4 text-sm text-amber-400 flex items-center gap-3" role="alert" data-testid="exclusions-error">
            <span>{error}</span><button className="underline" onClick={() => void load()}>{t("exclusions.retry")}</button>
          </div>
        )}
        {loading && !rules && !error && <div className="p-8 text-center text-sm text-muted-foreground">{t("exclusions.loading")}</div>}
        {rules && visible.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground" data-testid="exclusions-empty">
            {q ? t("exclusions.empty_filtered") : t("exclusions.empty_none")}
          </div>
        )}
        {visible.length > 0 && (
          <div className="overflow-x-auto" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                  {columns.map(c => <th key={c} className="px-4 py-3 text-left font-medium text-xs whitespace-nowrap" style={{ color: "hsl(var(--muted-foreground))" }}>{t(`exclusions.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const d = drafts[r.id];
                  const rb = !!busy[r.id];
                  return (
                    <tr key={r.id} data-testid={`row-rule-${r.id}`} className="align-top" style={{ borderBottom: i < visible.length - 1 ? "1px solid hsl(var(--border) / 0.5)" : undefined }}>
                      <td className="px-4 py-3">
                        {d ? <input type="text" aria-label={t("exclusions.col_pattern")} data-testid={`input-pattern-${r.id}`} value={d.pattern} onChange={e => setDrafts(p => ({ ...p, [r.id]: { ...d, pattern: e.target.value } }))}
                          className="w-full px-2 py-1 rounded text-xs font-mono" style={inputStyle} />
                          : <code className="font-mono text-xs break-all">{r.pattern}</code>}
                        {rowErrors[r.id] && <div className="text-xs text-amber-400 mt-1" role="alert" data-testid={`row-error-${r.id}`}>{rowErrors[r.id]}</div>}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {d ? <input type="text" aria-label={t("exclusions.col_note")} data-testid={`input-note-${r.id}`} value={d.note} onChange={e => setDrafts(p => ({ ...p, [r.id]: { ...d, note: e.target.value } }))}
                          className="w-full px-2 py-1 rounded text-xs" style={inputStyle} />
                          : <span className="text-xs text-muted-foreground">{r.note || "–"}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <input type="checkbox" data-testid={`toggle-active-${r.id}`} aria-label={t("exclusions.col_active")} checked={r.is_active} disabled={rb}
                          onChange={e => void patch(r, { is_active: e.target.checked })} />
                      </td>
                      <td className="px-4 py-3">
                        <input type="checkbox" data-testid={`toggle-counted-${r.id}`} aria-label={t("exclusions.col_counted")} checked={r.count_in_report} disabled={rb}
                          onChange={e => void patch(r, { count_in_report: e.target.checked })} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{fmt(r.updated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {d ? (<>
                            <button data-testid={`button-save-${r.id}`} disabled={rb} onClick={() => saveDraft(r)} title={t("exclusions.save")} aria-label={t("exclusions.save")}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md disabled:opacity-50" style={btnStyle}><Check className="w-3.5 h-3.5" /></button>
                            <button data-testid={`button-cancel-${r.id}`} disabled={rb} onClick={() => cancelDraft(r.id)} title={t("exclusions.cancel")} aria-label={t("exclusions.cancel")}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md" style={btnStyle}><X className="w-3.5 h-3.5" /></button>
                          </>) : (
                            <button data-testid={`button-edit-${r.id}`} onClick={() => setDrafts(p => ({ ...p, [r.id]: { pattern: r.pattern, note: r.note ?? "" } }))} title={t("exclusions.edit")} aria-label={t("exclusions.edit")}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md" style={btnStyle}><Pencil className="w-3.5 h-3.5" /></button>
                          )}
                          <button data-testid={`button-delete-${r.id}`} onClick={() => { setDeleteError(null); setDeleteTarget(r); }} title={t("exclusions.delete")} aria-label={t("exclusions.delete")}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:text-amber-400" style={btnStyle}><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div role="dialog" aria-modal="true" className="rounded-xl p-6 max-w-sm w-full mx-4 space-y-4" style={cardStyle}>
            <h3 className="font-semibold text-base">{t("exclusions.delete_title")}</h3>
            <p className="text-sm text-muted-foreground" data-testid="delete-confirm-text">{t("exclusions.delete_confirm", { pattern: deleteTarget.pattern })}</p>
            {deleteError && <div className="text-sm text-amber-400" role="alert" data-testid="delete-error">{deleteError}</div>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} data-testid="button-delete-cancel" className="px-4 py-2 rounded-lg text-sm" style={btnStyle}>{t("exclusions.cancel")}</button>
              <button onClick={() => void confirmDelete()} disabled={deleting} data-testid="button-delete-confirm" className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60" style={{ background: "#b45309", color: "white" }}>
                {deleting ? t("exclusions.deleting") : t("exclusions.delete_button")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
