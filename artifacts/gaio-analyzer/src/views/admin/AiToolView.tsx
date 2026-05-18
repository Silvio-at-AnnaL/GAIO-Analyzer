import { useState, useEffect } from "react";
import { Save, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/store/authStore";

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
}

interface AiStatus {
  provider: string;
  hasApiKey: { claude: boolean; openai: boolean; perplexity: boolean; gemini: boolean };
  lastCompletedAt: string | null;
}

type Provider = "claude" | "openai" | "perplexity" | "gemini";

const PROVIDERS: { id: Provider; label: string; keyLabel: string; defaultModel: string; hint: string; hintUrl: string }[] = [
  { id: "claude", label: "Claude (Anthropic)", keyLabel: "claude", defaultModel: "claude-sonnet-4-20250514", hint: "API-Key erhalten bei", hintUrl: "https://console.anthropic.com/" },
  { id: "openai", label: "ChatGPT / OpenAI",  keyLabel: "openai", defaultModel: "gpt-4o",                  hint: "API-Key erhalten bei", hintUrl: "https://platform.openai.com/api-keys" },
  { id: "perplexity", label: "Perplexity",    keyLabel: "perplexity", defaultModel: "llama-3.1-sonar-large-128k-online", hint: "API-Key erhalten bei", hintUrl: "https://www.perplexity.ai/settings/api" },
  { id: "gemini", label: "Google Gemini",     keyLabel: "gemini", defaultModel: "gemini-1.5-pro",           hint: "API-Key erhalten bei", hintUrl: "https://aistudio.google.com/app/apikey" },
];

function StatusDot({ has }: { has: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: has ? "#22c55e" : "#6b7280" }} />
      <span style={{ color: has ? "#22c55e" : "#6b7280" }}>{has ? "API-Key hinterlegt" : "Kein API-Key"}</span>
    </span>
  );
}

export function AiToolView() {
  const { adminFetch } = useAuth();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [activeTab, setActiveTab] = useState<Provider>("claude");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; type: "ok" | "err"; msg: string } | null>(null);
  const [editedKeys, setEditedKeys] = useState<Record<string, string>>({});
  const [editedModels, setEditedModels] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const [sRes, stRes] = await Promise.all([
        adminFetch("/api/admin/settings/ai"),
        adminFetch("/api/admin/settings/ai-status"),
      ]);
      if (sRes.ok) setSettings(await sRes.json());
      if (stRes.ok) setStatus(await stRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function showFeedback(key: string, type: "ok" | "err", msg: string) {
    setFeedback({ key, type, msg });
    setTimeout(() => setFeedback(null), 3500);
  }

  async function saveProvider(provider: Provider) {
    setSaving("provider");
    const res = await adminFetch("/api/admin/settings/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_provider: provider }),
    });
    setSaving(null);
    if (res.ok) {
      setStatus((s) => s ? { ...s, provider } : s);
      showFeedback("provider", "ok", "Anbieter gespeichert");
    } else {
      showFeedback("provider", "err", "Fehler beim Speichern");
    }
  }

  async function saveCredentials(p: Provider) {
    setSaving(p);
    const body: Record<string, string> = {};
    const key = editedKeys[p];
    const model = editedModels[p];
    if (key !== undefined) body[`ai_api_key_${p}`] = key;
    if (model !== undefined) body[`ai_model_${p}`] = model;

    const res = await adminFetch("/api/admin/settings/ai", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(null);
    if (res.ok) {
      await load();
      setEditedKeys((e) => { const n = { ...e }; delete n[p]; return n; });
      setEditedModels((e) => { const n = { ...e }; delete n[p]; return n; });
      showFeedback(p, "ok", "Zugangsdaten gespeichert");
    } else {
      showFeedback(p, "err", "Fehler beim Speichern");
    }
  }

  function modelKey(p: Provider): keyof AiSettings {
    return `ai_model_${p}` as keyof AiSettings;
  }
  function apiKeyKey(p: Provider): keyof AiSettings {
    return `ai_api_key_${p}` as keyof AiSettings;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
      </div>
    );
  }

  const currentProvider = (status?.provider ?? settings?.ai_provider ?? "claude") as Provider;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">KI-Tool</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          KI-Anbieter und API-Zugangsdaten für die Analyse konfigurieren
        </p>
      </div>

      {/* Section 1: Active provider */}
      <div className="rounded-lg border p-5 space-y-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <h2 className="text-base font-semibold">Aktiver KI-Anbieter</h2>
        <div className="space-y-3">
          {PROVIDERS.map((p) => {
            const hasKey = status?.hasApiKey?.[p.id] ?? false;
            return (
              <label key={p.id} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="provider"
                  value={p.id}
                  checked={currentProvider === p.id}
                  onChange={() => void saveProvider(p.id)}
                  className="accent-blue-500"
                />
                <span className="flex-1 text-sm font-medium">{p.label}</span>
                <StatusDot has={hasKey} />
              </label>
            );
          })}
        </div>
        {feedback?.key === "provider" && (
          <div className={`flex items-center gap-2 text-sm ${feedback.type === "ok" ? "text-green-400" : "text-red-400"}`}>
            {feedback.type === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {feedback.msg}
          </div>
        )}
      </div>

      {/* Section 2: Credentials per tab */}
      <div className="rounded-lg border p-5 space-y-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <h2 className="text-base font-semibold">API-Zugangsdaten</h2>

        {/* Tab switcher */}
        <div className="flex gap-1 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveTab(p.id)}
              className="px-4 py-2 text-sm font-medium transition-colors"
              style={{
                borderBottom: activeTab === p.id ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                color: activeTab === p.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                background: "transparent",
              }}
            >
              {p.id === "claude" ? "Claude" : p.id === "openai" ? "OpenAI" : p.id === "perplexity" ? "Perplexity" : "Gemini"}
            </button>
          ))}
        </div>

        {PROVIDERS.filter((p) => p.id === activeTab).map((p) => {
          const hasKey = status?.hasApiKey?.[p.id] ?? false;
          const currentModel = editedModels[p.id] ?? settings?.[modelKey(p.id)] ?? p.defaultModel;
          const currentKey = editedKeys[p.id] ?? settings?.[apiKeyKey(p.id)] ?? "";
          return (
            <div key={p.id} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">API-Key</label>
                <input
                  type="password"
                  value={editedKeys[p.id] ?? currentKey}
                  placeholder={hasKey ? "••••••••••••" : "sk-..."}
                  onFocus={(e) => { if (!editedKeys[p.id]) { e.target.value = ""; setEditedKeys((prev) => ({ ...prev, [p.id]: "" })); } }}
                  onChange={(e) => setEditedKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-sm border"
                  style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                />
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {p.hint}{" "}
                  <a href={p.hintUrl} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">{p.hintUrl}</a>
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Modell</label>
                <input
                  type="text"
                  value={currentModel}
                  onChange={(e) => setEditedModels((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-md text-sm border"
                  style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                />
              </div>

              <button
                onClick={() => void saveCredentials(p.id)}
                disabled={saving === p.id}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
              >
                {saving === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Zugangsdaten speichern
              </button>

              {feedback?.key === p.id && (
                <div className={`flex items-center gap-2 text-sm ${feedback.type === "ok" ? "text-green-400" : "text-red-400"}`}>
                  {feedback.type === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {feedback.msg}
                </div>
              )}
            </div>
          );
        })}

        {/* Info box */}
        {status && (
          <div className="rounded-md p-3 text-sm space-y-1" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            <p>
              <span className="font-medium">Aktiver Anbieter:</span>{" "}
              {PROVIDERS.find((p) => p.id === status.provider)?.label ?? status.provider}
            </p>
            {status.lastCompletedAt && (
              <p>
                <span className="font-medium">Letzte Analyse:</span>{" "}
                {new Date(status.lastCompletedAt).toLocaleString("de-DE")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
