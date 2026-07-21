import { useState, useEffect } from "react";
import { Save, RotateCcw, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { adminFetch } from "@/store/authStore";
import { useT } from "@/lib/LabelProvider";

interface Placeholder {
  key: string;
  description: string;
}

interface PromptListItem {
  id: number;
  slug: string;
  name: string;
  description: string;
  module: string;
  isModified: boolean;
  updatedAt: string;
}

interface PromptDetail extends PromptListItem {
  template: string;
  placeholders: Placeholder[];
  defaultTemplate: string;
}

export function PromptVerwaltungView() {
  const t = useT();
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [selected, setSelected] = useState<PromptDetail | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    adminFetch("/api/admin/prompts")
      .then((r) => r.json())
      .then((data: { prompts: PromptListItem[] }) => setPrompts(data.prompts ?? []))
      .catch(() => {});
  }, []);

  const loadPrompt = (slug: string) => {
    setLoadingDetail(true);
    setSelected(null);
    setSaveMsg(null);
    setShowOriginal(false);
    adminFetch(`/api/admin/prompts/${slug}`)
      .then((r) => r.json())
      .then((data: PromptDetail) => {
        setSelected(data);
        setEditorValue(data.template);
      })
      .finally(() => setLoadingDetail(false));
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await adminFetch(`/api/admin/prompts/${selected.slug}`, {
        method: "PATCH",
        body: JSON.stringify({ template: editorValue }),
      });
      if (r.ok) {
        const updated = { ...selected, template: editorValue, isModified: true };
        setSelected(updated);
        setPrompts((prev) => prev.map((p) => (p.slug === selected.slug ? { ...p, isModified: true } : p)));
        setSaveMsg(t("texts.saved_msg"));
      } else {
        setSaveMsg(t("delivery.save_error"));
      }
    } catch {
      setSaveMsg(t("delivery.save_error"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!selected) return;
    setResetting(true);
    setSaveMsg(null);
    try {
      const r = await adminFetch(`/api/admin/prompts/${selected.slug}/reset`, { method: "POST" });
      if (r.ok) {
        const data: PromptDetail = await r.json();
        setSelected(data);
        setEditorValue(data.template);
        setPrompts((prev) => prev.map((p) => (p.slug === selected.slug ? { ...p, isModified: false } : p)));
        setSaveMsg(t("prompts.reset_done"));
      }
    } catch {
      setSaveMsg(t("texts.reset_error"));
    } finally {
      setResetting(false);
    }
  };

  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    });
  };

  const grouped = prompts.reduce<Record<string, PromptListItem[]>>((acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  }, {});

  const isDirty = selected ? editorValue !== selected.template : false;

  return (
    <div className="flex gap-6 h-full min-h-0" style={{ minHeight: "calc(100vh - 120px)" }}>
      {/* ── Left panel: prompt list ─────────────────────────────────────────────── */}
      <div
        className="w-64 flex-shrink-0 rounded-lg border overflow-y-auto"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--border))",
        }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <h2 className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
            {t("nav.admin_prompt_verwaltung")}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            {t("prompts.modified_count", { modified: prompts.filter((p) => p.isModified).length, total: prompts.length })}
          </p>
        </div>
        <div className="py-2">
          {Object.entries(grouped).map(([module, items]) => (
            <div key={module}>
              <div
                className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                {module}
              </div>
              {items.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => loadPrompt(p.slug)}
                  className="w-full text-left px-4 py-2.5 transition-colors"
                  style={{
                    background: selected?.slug === p.slug ? "hsl(var(--accent))" : "transparent",
                    color:
                      selected?.slug === p.slug
                        ? "hsl(var(--accent-foreground))"
                        : "hsl(var(--foreground))",
                    borderLeft:
                      selected?.slug === p.slug ? "3px solid hsl(var(--primary))" : "3px solid transparent",
                  }}
                >
                  <div className="text-sm font-medium leading-tight">{p.name}</div>
                  {p.isModified && (
                    <div
                      className="text-xs mt-0.5"
                      style={{ color: "hsl(var(--chart-4))" }}
                    >
                      {t("texts.badge_customized")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel: editor ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        {!selected && !loadingDetail && (
          <div
            className="flex-1 rounded-lg border flex items-center justify-center"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              {t("prompts.empty_hint")}
            </p>
          </div>
        )}

        {loadingDetail && (
          <div
            className="flex-1 rounded-lg border flex items-center justify-center"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            <p className="text-sm animate-pulse" style={{ color: "hsl(var(--muted-foreground))" }}>
              {t("prompts.loading")}
            </p>
          </div>
        )}

        {selected && !loadingDetail && (
          <>
            {/* Header */}
            <div
              className="rounded-lg border px-5 py-4"
              style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                    {selected.name}
                  </h3>
                  <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {selected.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selected.isModified && (
                    <button
                      onClick={handleReset}
                      disabled={resetting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border transition-colors"
                      style={{
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--muted-foreground))",
                      }}
                      title={t("prompts.reset_title")}
                    >
                      <RotateCcw size={14} />
                      {resetting ? "…" : t("texts.reset_button")}
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || !isDirty}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-opacity"
                    style={{
                      background: "hsl(var(--primary))",
                      color: "hsl(var(--primary-foreground))",
                      opacity: saving || !isDirty ? 0.5 : 1,
                      cursor: saving || !isDirty ? "not-allowed" : "pointer",
                    }}
                  >
                    <Save size={14} />
                    {saving ? t("texts.saving_loading") : t("profile.save_button")}
                  </button>
                </div>
              </div>
              {saveMsg && (
                <p
                  className="text-xs mt-2"
                  style={{
                    color: saveMsg.startsWith("Fehler")
                      ? "hsl(var(--destructive))"
                      : "hsl(var(--chart-2))",
                  }}
                >
                  {saveMsg}
                </p>
              )}
            </div>

            {/* Placeholders */}
            {selected.placeholders.length > 0 && (
              <div
                className="rounded-lg border px-5 py-3"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              >
                <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {t("prompts.placeholders_label")}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.placeholders.map((ph) => (
                    <button
                      key={ph.key}
                      onClick={() => handleCopy(ph.key)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-mono border transition-colors"
                      style={{
                        background: "hsl(var(--muted))",
                        borderColor: "hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                      }}
                      title={ph.description}
                    >
                      {copiedKey === ph.key ? (
                        <Check size={11} style={{ color: "hsl(var(--chart-2))" }} />
                      ) : (
                        <Copy size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
                      )}
                      {ph.key}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Editor */}
            <div
              className="rounded-lg border flex flex-col"
              style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
            >
              <div
                className="flex items-center justify-between px-4 py-2 border-b"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {t("prompts.template_label")}
                </span>
                <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {t("prompts.char_count", { count: editorValue.length.toLocaleString() })}
                  {isDirty && (
                    <span style={{ color: "hsl(var(--chart-4))" }}> · {t("texts.unsaved")}</span>
                  )}
                </span>
              </div>
              <textarea
                value={editorValue}
                onChange={(e) => setEditorValue(e.target.value)}
                spellCheck={false}
                className="flex-1 resize-none p-4 font-mono text-sm focus:outline-none"
                style={{
                  background: "transparent",
                  color: "hsl(var(--foreground))",
                  minHeight: 320,
                  lineHeight: 1.6,
                }}
              />
            </div>

            {/* Original (diff) */}
            {selected.isModified && (
              <div
                className="rounded-lg border"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              >
                <button
                  onClick={() => setShowOriginal((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium transition-colors"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  <span>{t("prompts.show_default")}</span>
                  {showOriginal ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {showOriginal && (
                  <div className="px-4 pb-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                    <p className="text-xs py-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {t("prompts.readonly_note")}
                    </p>
                    <textarea
                      readOnly
                      value={selected.defaultTemplate}
                      spellCheck={false}
                      className="w-full resize-none p-3 rounded font-mono text-xs focus:outline-none"
                      style={{
                        background: "hsl(var(--muted))",
                        color: "hsl(var(--muted-foreground))",
                        minHeight: 200,
                        lineHeight: 1.6,
                        border: "1px solid hsl(var(--border))",
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
