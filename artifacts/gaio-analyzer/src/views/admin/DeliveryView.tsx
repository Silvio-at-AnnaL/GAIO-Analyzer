import { useState, useEffect } from "react";
import { Save, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { adminFetch } from "@/store/authStore";

interface DeliverySettings {
  delivery_mode: string;
  delivery_bcc: string;
  delivery_require_email: string;
}

export function DeliveryView() {
  const [form, setForm] = useState<DeliverySettings>({
    delivery_mode: "download",
    delivery_bcc: "",
    delivery_require_email: "false",
  });
  const [mailHost, setMailHost] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [bccError, setBccError] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const [deliveryRes, mailRes] = await Promise.all([
      adminFetch("/api/admin/settings/delivery"),
      adminFetch("/api/admin/settings/mail"),
    ]);
    if (deliveryRes.ok) setForm(await deliveryRes.json());
    if (mailRes.ok) {
      const m = await mailRes.json() as { mail_host?: string };
      setMailHost(m.mail_host ?? "");
    }
    setLoading(false);
  }

  async function handleSave() {
    setBccError(null);
    if (form.delivery_mode === "mail-only" && !form.delivery_bcc.trim()) {
      setBccError("Eine BCC-Adresse ist erforderlich, wenn der E-Mail-Versand aktiv ist.");
      return;
    }

    setSaving(true);
    setFeedback(null);
    const res = await adminFetch("/api/admin/settings/delivery", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      setFeedback({ type: "ok", msg: "Einstellungen gespeichert" });
      setTimeout(() => setFeedback(null), 3500);
    } else {
      setFeedback({ type: "err", msg: "Fehler beim Speichern" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Versand-Analyse</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          Bereitstellungsmodus für Analyseberichte konfigurieren
        </p>
      </div>

      <div className="rounded-lg border p-5 space-y-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <h2 className="text-base font-semibold">Bereitstellung von Analyseberichten</h2>

        {/* Mode selection */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Bereitstellungsmodus</p>

          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border transition-colors"
            style={{ borderColor: form.delivery_mode === "download" ? "hsl(var(--primary))" : "hsl(var(--border))", background: form.delivery_mode === "download" ? "hsl(var(--primary) / 0.06)" : "transparent" }}>
            <input
              type="radio"
              name="delivery_mode"
              value="download"
              checked={form.delivery_mode === "download"}
              onChange={() => setForm((f) => ({ ...f, delivery_mode: "download" }))}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <p className="text-sm font-medium">Download (Standard)</p>
              <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                Nutzer laden PDF/HTML direkt herunter.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border transition-colors"
            style={{ borderColor: form.delivery_mode === "mail-only" ? "hsl(var(--primary))" : "hsl(var(--border))", background: form.delivery_mode === "mail-only" ? "hsl(var(--primary) / 0.06)" : "transparent" }}>
            <input
              type="radio"
              name="delivery_mode"
              value="mail-only"
              checked={form.delivery_mode === "mail-only"}
              onChange={() => setForm((f) => ({ ...f, delivery_mode: "mail-only" }))}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <p className="text-sm font-medium">Nur per E-Mail</p>
              <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                Nutzer geben eine Mailadresse ein; der Report wird zugesandt.
              </p>
            </div>
          </label>
        </div>

        {/* BCC field — shown only when mail-only */}
        {form.delivery_mode === "mail-only" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              BCC-Adresse <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={form.delivery_bcc}
              onChange={(e) => { setForm((f) => ({ ...f, delivery_bcc: e.target.value })); setBccError(null); }}
              placeholder="admin@example.com"
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={{
                background: "hsl(var(--input))",
                borderColor: bccError ? "#f87171" : "hsl(var(--border))",
                color: "hsl(var(--foreground))",
              }}
            />
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              Jeder versandte Report wird zusätzlich an diese Adresse als BCC-Kopie gesendet.
            </p>
            {bccError && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> {bccError}
              </p>
            )}
          </div>
        )}

        {/* Mail server status indicator */}
        {form.delivery_mode === "mail-only" && (
          <div className={`flex items-center gap-2 text-sm rounded-md px-3 py-2 border ${mailHost ? "border-green-700/40 bg-green-900/20 text-green-400" : "border-amber-700/40 bg-amber-900/20 text-amber-400"}`}>
            {mailHost
              ? <><CheckCircle className="w-4 h-4 shrink-0" /> Mailserver konfiguriert ({mailHost})</>
              : <><AlertCircle className="w-4 h-4 shrink-0" /> Kein Mailserver konfiguriert – E-Mail-Versand nicht möglich. Bitte zuerst den Mailserver einrichten.</>
            }
          </div>
        )}

        {/* Save button */}
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Einstellungen speichern
        </button>

        {feedback && (
          <div className={`flex items-center gap-2 text-sm ${feedback.type === "ok" ? "text-green-400" : "text-red-400"}`}>
            {feedback.type === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {feedback.msg}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-md p-4 text-sm" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
        Die E-Mail-Versandfunktion ist vorbereitet und wird nach Konfiguration des Mailservers aktiviert.
        Im aktuellen Zustand wird immer der direkte Download verwendet, unabhängig von dieser Einstellung.
      </div>
    </div>
  );
}
