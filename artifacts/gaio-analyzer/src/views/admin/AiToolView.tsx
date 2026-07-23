import { useState, useEffect } from "react";
import { Save, CheckCircle, AlertCircle, Loader2, Plus, Trash2, Pencil, X } from "lucide-react";
import { adminFetch } from "@/store/authStore";
import { useT, useLabelContext } from "@/lib/LabelProvider";

interface AiSettings {
  ai_provider: string;
  ai_model_claude: string;
  ai_api_key_claude: string;
  ai_model_openai: string;
  ai_api_key_openai: string;
  ai_api_key_perplexity: string;
  ai_model_perplexity: string;
  ai_api_key_gemini: string;
  ai_model_gemini: string;
  ai_custom_providers: string;
}

interface AiStatus {
  provider: string;
  hasApiKey: { claude: boolean; openai: boolean; perplexity: boolean; gemini: boolean };
  lastCompletedAt: string | null;
}

interface CustomProvider {
  id: string;
  name: string;
  api_key: string;
  base_url: string;
  model: string;
  enabled: boolean;
}

type BuiltinId = "claude" | "openai" | "perplexity" | "gemini";

const BUILTINS: { id: BuiltinId; label: string; defaultModel: string; hint: string; hintUrl: string }[] = [
  { id: "claude",     label: "Claude (Anthropic)", defaultModel: "claude-sonnet-4-20250514",           hint: "ai.hint_key_from", hintUrl: "https://console.anthropic.com/" },
  { id: "openai",     label: "ChatGPT / OpenAI",   defaultModel: "gpt-4o",                            hint: "ai.hint_key_from", hintUrl: "https://platform.openai.com/api-keys" },
  { id: "perplexity", label: "Perplexity",          defaultModel: "llama-3.1-sonar-large-128k-online", hint: "ai.hint_key_from", hintUrl: "https://www.perplexity.ai/settings/api" },
  { id: "gemini",     label: "Google Gemini",       defaultModel: "gemini-1.5-pro",                    hint: "ai.hint_key_from", hintUrl: "https://aistudio.google.com/app/apikey" },
];

function StatusDot({ has }: { has: boolean }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: has ? "#3b82f6" : "#6b7280" }} />
      <span style={{ color: has ? "#3b82f6" : "#6b7280" }}>{has ? t("ai.key_present") : t("ai.key_missing")}</span>
    </span>
  );
}

function FeedbackLine({ type, msg }: { type: "ok" | "err"; msg: string }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${type === "ok" ? "text-blue-400" : "text-amber-400"}`}>
      {type === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {msg}
    </div>
  );
}

const EMPTY_NEW_PROV = { name: "", api_key: "", base_url: "", model: "" };

export function AiToolView() {
  const t = useT();
  const { locale } = useLabelContext();
  const intlLocale = locale === "en" ? "en-US" : "de-DE";
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [status, setStatus]     = useState<AiStatus | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; type: "ok" | "err"; msg: string } | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [activeTab, setActiveTab]   = useState<string>("claude");
  const [editedKeys, setEditedKeys]     = useState<Record<string, string>>({});
  const [editedModels, setEditedModels] = useState<Record<string, string>>({});

  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editProv, setEditProv]     = useState<CustomProvider | null>(null);
  const [newProv, setNewProv]       = useState<typeof EMPTY_NEW_PROV>({ ...EMPTY_NEW_PROV });

  async function load() {
    setLoading(true);
    try {
      const [sRes, stRes] = await Promise.all([
        adminFetch("/api/admin/settings/ai"),
        adminFetch("/api/admin/settings/ai-status"),
      ]);
      if (sRes.ok) {
        const s = await sRes.json() as AiSettings;
        setSettings(s);
        let cps: CustomProvider[] = [];
        try { cps = JSON.parse(s.ai_custom_providers || "[]") as CustomProvider[]; } catch { /* ignore */ }
        setCustomProviders(cps);
      }
      if (stRes.ok) {
        const st = await stRes.json() as AiStatus;
        setStatus(st);
        setSelectedProvider(prev => prev || (st.provider ?? "claude"));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function showFeedback(key: string, type: "ok" | "err", msg: string) {
    setFeedback({ key, type, msg });
    setTimeout(() => setFeedback(null), 4000);
  }

  const currentProvider = status?.provider ?? settings?.ai_provider ?? "claude";
  const pendingSwitch   = selectedProvider !== "" && selectedProvider !== currentProvider;

  const builtinHasKey: Record<string, boolean> = {
    claude:     !!(status?.hasApiKey?.claude),
    openai:     !!(status?.hasApiKey?.openai),
    perplexity: !!(status?.hasApiKey?.perplexity),
    gemini:     !!(status?.hasApiKey?.gemini),
  };
  const builtinWithKeysCount  = Object.values(builtinHasKey).filter(Boolean).length;
  const customWithKeysCount   = customProviders.filter(cp => !!cp.api_key).length;
  const totalWithKeys         = builtinWithKeysCount + customWithKeysCount;

  const allProviderOptions = [
    ...BUILTINS.map(b => ({ id: b.id as string, label: b.label, isCustom: false, hasKey: builtinHasKey[b.id] })),
    ...customProviders.map(cp => ({ id: cp.id, label: cp.name, isCustom: true, hasKey: !!cp.api_key })),
  ];

  async function saveProvider() {
    setSaving("provider");
    const res = await adminFetch("/api/admin/settings/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_provider: selectedProvider }),
    });
    setSaving(null);
    if (res.ok) {
      setStatus(s => s ? { ...s, provider: selectedProvider } : s);
      const label = allProviderOptions.find(p => p.id === selectedProvider)?.label ?? selectedProvider;
      showFeedback("provider", "ok", t("ai.provider_activated", { name: label }));
    } else {
      showFeedback("provider", "err", t("delivery.save_error"));
    }
  }

  async function saveBuiltinCredentials(id: BuiltinId) {
    setSaving(id);
    const body: Record<string, string> = {};
    if (editedKeys[id]   !== undefined) body[`ai_api_key_${id}`] = editedKeys[id];
    if (editedModels[id] !== undefined) body[`ai_model_${id}`]   = editedModels[id];
    const res = await adminFetch("/api/admin/settings/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(null);
    if (res.ok) {
      await load();
      setEditedKeys(e   => { const n = { ...e }; delete n[id]; return n; });
      setEditedModels(e => { const n = { ...e }; delete n[id]; return n; });
      showFeedback(id, "ok", t("ai.credentials_saved"));
    } else {
      showFeedback(id, "err", t("delivery.save_error"));
    }
  }

  async function saveCustomProviders(updated: CustomProvider[], feedbackKey = "custom") {
    const res = await adminFetch("/api/admin/settings/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_custom_providers: JSON.stringify(updated) }),
    });
    return res.ok;
  }

  async function addCustomProvider() {
    if (!newProv.name || !newProv.base_url || !newProv.model) return;
    const slug = newProv.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const id   = `${slug}-${Date.now().toString(36)}`;
    const cp: CustomProvider = { ...newProv, id, enabled: true };
    const updated = [...customProviders, cp];
    setSaving("custom-add");
    const ok = await saveCustomProviders(updated);
    setSaving(null);
    if (ok) {
      setCustomProviders(updated);
      setNewProv({ ...EMPTY_NEW_PROV });
      setShowAddForm(false);
      showFeedback("custom", "ok", t("ai.provider_added", { name: cp.name }));
    } else {
      showFeedback("custom", "err", t("delivery.save_error"));
    }
  }

  async function updateCustomProvider() {
    if (!editProv) return;
    const updated = customProviders.map(cp => cp.id === editProv.id ? editProv : cp);
    setSaving("custom-edit");
    const ok = await saveCustomProviders(updated);
    setSaving(null);
    if (ok) {
      await load();
      setEditingId(null);
      setEditProv(null);
      showFeedback("custom", "ok", t("ai.provider_updated"));
    } else {
      showFeedback("custom", "err", t("delivery.save_error"));
    }
  }

  async function deleteCustomProvider(id: string) {
    const updated = customProviders.filter(cp => cp.id !== id);
    setSaving(`custom-del-${id}`);
    const ok = await saveCustomProviders(updated);
    setSaving(null);
    if (ok) {
      setCustomProviders(updated);
      if (activeTab === id) setActiveTab("claude");
      showFeedback("custom", "ok", t("ai.provider_removed"));
    } else {
      showFeedback("custom", "err", t("users.delete_error"));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
      </div>
    );
  }

  const inputStyle = { background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" };
  const cardStyle  = { background: "hsl(var(--card))", borderColor: "hsl(var(--border))" };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("nav.admin_ki_tool")}</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          {t("ai.subtitle")}
        </p>
      </div>

      {/* ── SECTION 1: Active provider selection ─────────────────────────── */}
      <div className="rounded-lg border p-5 space-y-4" style={cardStyle}>
        <h2 className="text-base font-semibold">{t("ai.section_active")}</h2>

        {totalWithKeys < 2 ? (
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            {t("ai.active_provider_label")}{" "}
            <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>
              {allProviderOptions.find(p => p.id === currentProvider)?.label ?? currentProvider}
            </span>
            {" "}{t("ai.only_one_key")}
          </p>
        ) : (
          <div className="space-y-2">
            {allProviderOptions.map(prov => {
              const isActive   = prov.id === currentProvider;
              const isSelected = prov.id === selectedProvider;
              return (
                <label
                  key={prov.id}
                  className="flex items-center gap-3 p-3 rounded-md cursor-pointer transition-all"
                  style={{
                    border:      isActive ? "2px solid #2563eb" : "1px solid hsl(var(--border))",
                    background:  isActive ? "rgba(37,99,235,0.08)" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="provider"
                    value={prov.id}
                    checked={isSelected}
                    onChange={() => setSelectedProvider(prov.id)}
                    className="accent-blue-500"
                  />
                  <span className="flex-1 text-sm" style={{ fontWeight: isActive ? 600 : 400 }}>
                    {prov.label}
                    {prov.isCustom && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs" style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>{t("ai.badge_custom")}</span>
                    )}
                    {isActive && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-semibold" style={{ background: "rgba(37,99,235,0.2)", color: "#3b82f6" }}>{t("users.status_active")}</span>
                    )}
                  </span>
                  <StatusDot has={prov.hasKey} />
                </label>
              );
            })}
          </div>
        )}

        {pendingSwitch && (
          <button
            onClick={() => void saveProvider()}
            disabled={saving === "provider"}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            style={{ background: "#2563eb", color: "white" }}
          >
            {saving === "provider" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Anbieter wechseln & speichern
          </button>
        )}

        {feedback?.key === "provider" && <FeedbackLine type={feedback.type} msg={feedback.msg} />}
      </div>

      {/* ── SECTION 2: API credentials ────────────────────────────────────── */}
      <div className="rounded-lg border p-5 space-y-4" style={cardStyle}>
        <h2 className="text-base font-semibold">{t("ai.section_credentials")}</h2>

        <div className="flex gap-1 flex-wrap border-b" style={{ borderColor: "hsl(var(--border))" }}>
          {BUILTINS.map(b => (
            <button key={b.id} onClick={() => setActiveTab(b.id)}
              className="px-3 py-2 text-sm font-medium transition-colors"
              style={{
                borderBottom: activeTab === b.id ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                color:        activeTab === b.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                background:   "transparent",
              }}>
              {b.id === "claude" ? "Claude" : b.id === "openai" ? "OpenAI" : b.id === "perplexity" ? "Perplexity" : "Gemini"}
            </button>
          ))}
          {customProviders.map(cp => (
            <button key={cp.id} onClick={() => setActiveTab(cp.id)}
              className="px-3 py-2 text-sm font-medium transition-colors"
              style={{
                borderBottom: activeTab === cp.id ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                color:        activeTab === cp.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                background:   "transparent",
              }}>
              {cp.name}
            </button>
          ))}
        </div>

        {/* Builtin credential form */}
        {BUILTINS.filter(b => b.id === activeTab).map(b => {
          const hasKey      = status?.hasApiKey?.[b.id] ?? false;
          const currentModel = editedModels[b.id] ?? settings?.[`ai_model_${b.id}` as keyof AiSettings] ?? b.defaultModel;
          const currentKey   = editedKeys[b.id]   ?? settings?.[`ai_api_key_${b.id}` as keyof AiSettings] ?? "";
          return (
            <div key={b.id} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("ai.api_key_label")}</label>
                <input
                  type="password"
                  value={editedKeys[b.id] ?? currentKey}
                  placeholder={hasKey ? "••••••••••••" : "sk-..."}
                  onFocus={e => { if (!editedKeys[b.id]) { e.target.value = ""; setEditedKeys(prev => ({ ...prev, [b.id]: "" })); } }}
                  onChange={e => setEditedKeys(prev => ({ ...prev, [b.id]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-sm border"
                  style={inputStyle}
                />
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {t(b.hint)}{" "}
                  <a href={b.hintUrl} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">{b.hintUrl}</a>
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("ai.model_label")}</label>
                <input
                  type="text"
                  value={currentModel}
                  onChange={e => setEditedModels(prev => ({ ...prev, [b.id]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-sm border"
                  style={inputStyle}
                />
              </div>
              <button
                onClick={() => void saveBuiltinCredentials(b.id)}
                disabled={saving === b.id}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
              >
                {saving === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t("ai.save_credentials_button")}
              </button>
              {feedback?.key === b.id && <FeedbackLine type={feedback.type} msg={feedback.msg} />}
            </div>
          );
        })}

        {/* Custom provider credentials summary */}
        {customProviders.filter(cp => cp.id === activeTab).map(cp => (
          <div key={cp.id} className="space-y-3">
            <div className="rounded-md p-3 text-sm space-y-1" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              <p><span className="font-medium text-foreground">{t("ai.base_url_colon")}</span> <span className="font-mono">{cp.base_url}</span></p>
              <p><span className="font-medium text-foreground">{t("ai.model_colon")}</span> <span className="font-mono">{cp.model}</span></p>
              <p><span className="font-medium text-foreground">{t("ai.api_key_colon")}</span> {cp.api_key ? t("ai.key_set") : t("ai.key_unset")}</p>
            </div>
            <button
              onClick={() => { setEditingId(cp.id); setEditProv({ ...cp }); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-sm"
              style={{ border: "1px solid hsl(var(--border))" }}>
              <Pencil className="w-3.5 h-3.5" /> {t("ai.edit_button")}
            </button>
          </div>
        ))}

        {status && (
          <div className="rounded-md p-3 text-sm space-y-1" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            <p>
              {t("ai.active_provider_label")}{" "}
              {allProviderOptions.find(p => p.id === currentProvider)?.label ?? currentProvider}
            </p>
            {status.lastCompletedAt && (
              <p><span className="font-medium">{t("ai.last_analysis")}</span>{" "}{new Date(status.lastCompletedAt).toLocaleString(intlLocale)}</p>
            )}
          </div>
        )}
      </div>

      {/* ── SECTION 3: Custom providers ──────────────────────────────────── */}
      <div className="rounded-lg border p-5 space-y-4" style={cardStyle}>
        <div>
          <h2 className="text-base font-semibold">{t("ai.section_more")}</h2>
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            {t("ai.more_providers_hint")}
          </p>
        </div>

        {/* Existing custom providers table */}
        {customProviders.length > 0 && (
          <div className="rounded-md overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                  {["ai.name_label", "ai.base_url_label", "ai.model_label", "users.col_status", "users.col_actions"].map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customProviders.map(cp => (
                  <tr key={cp.id} style={{ borderBottom: "1px solid hsl(var(--border) / 0.5)" }}>
                    <td className="px-3 py-2 font-medium">{cp.name}</td>
                    <td className="px-3 py-2 text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{cp.base_url}</td>
                    <td className="px-3 py-2 text-xs font-mono">{cp.model}</td>
                    <td className="px-3 py-2"><StatusDot has={!!cp.api_key} /></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setEditingId(cp.id); setEditProv({ ...cp }); setActiveTab(cp.id); }}
                          className="p-1 rounded transition-colors hover:text-blue-400 hover:bg-blue-500/10"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                          title={t("ai.edit_button")}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void deleteCustomProvider(cp.id)}
                          disabled={saving === `custom-del-${cp.id}`}
                          className="p-1 rounded transition-colors hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-40"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                          title={t("ai.remove_title")}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Inline edit form */}
        {editingId && editProv && (
          <div className="rounded-md border p-4 space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
            <p className="text-sm font-medium">Anbieter bearbeiten: {editProv.name}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{t("ai.name_label")}</label>
                <input type="text" value={editProv.name} onChange={e => setEditProv({ ...editProv, name: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded text-sm border" style={inputStyle} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{t("ai.model_id_label")}</label>
                <input type="text" value={editProv.model} onChange={e => setEditProv({ ...editProv, model: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded text-sm border" style={inputStyle} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-medium">{t("ai.base_url_label")}</label>
                <input type="text" value={editProv.base_url} onChange={e => setEditProv({ ...editProv, base_url: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded text-sm border font-mono" style={inputStyle} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-medium">{t("ai.api_key_label")} <span style={{ color: "hsl(var(--muted-foreground))" }}>{t("ai.leave_empty_hint")}</span></label>
                <input type="password" value={editProv.api_key} onChange={e => setEditProv({ ...editProv, api_key: e.target.value })}
                  placeholder="••••••••" className="w-full px-2.5 py-1.5 rounded text-sm border" style={inputStyle} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void updateCustomProvider()} disabled={saving === "custom-edit"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                {saving === "custom-edit" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {t("profile.save_button")}
              </button>
              <button onClick={() => { setEditingId(null); setEditProv(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm"
                style={{ border: "1px solid hsl(var(--border))" }}>
                <X className="w-3.5 h-3.5" /> {t("domain.aria_cancel")}
              </button>
            </div>
          </div>
        )}

        {/* Inline add form */}
        {showAddForm ? (
          <div className="rounded-md border p-4 space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
            <p className="text-sm font-medium">{t("ai.add_provider_heading")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">{t("ai.name_label")} <span style={{ color: "#d97706" }}>*</span></label>
                <input type="text" placeholder="Mistral Large" value={newProv.name}
                  onChange={e => setNewProv({ ...newProv, name: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded text-sm border" style={inputStyle} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">{t("ai.model_id_label")} <span style={{ color: "#d97706" }}>*</span></label>
                <input type="text" placeholder="mistral-large-latest" value={newProv.model}
                  onChange={e => setNewProv({ ...newProv, model: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded text-sm border" style={inputStyle} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-medium">{t("ai.base_url_label")} <span style={{ color: "#d97706" }}>*</span></label>
                <input type="text" placeholder="https://api.mistral.ai/v1" value={newProv.base_url}
                  onChange={e => setNewProv({ ...newProv, base_url: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded text-sm border font-mono" style={inputStyle} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-medium">{t("ai.api_key_label")}</label>
                <input type="password" placeholder="sk-..." value={newProv.api_key}
                  onChange={e => setNewProv({ ...newProv, api_key: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded text-sm border" style={inputStyle} />
              </div>
            </div>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              {t("ai.openai_compatible_hint")}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void addCustomProvider()}
                disabled={!newProv.name || !newProv.base_url || !newProv.model || saving === "custom-add"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                {saving === "custom-add" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {t("ai.add_button")}
              </button>
              <button onClick={() => { setShowAddForm(false); setNewProv({ ...EMPTY_NEW_PROV }); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm"
                style={{ border: "1px solid hsl(var(--border))" }}>
                <X className="w-3.5 h-3.5" /> {t("domain.aria_cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-sm"
            style={{ border: "1px solid hsl(var(--border))" }}>
            <Plus className="w-3.5 h-3.5" /> {t("ai.add_provider_heading")}
          </button>
        )}

        {feedback?.key === "custom" && <FeedbackLine type={feedback.type} msg={feedback.msg} />}
      </div>
    </div>
  );
}
