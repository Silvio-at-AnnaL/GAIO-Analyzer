import { useState, useEffect } from "react";
import { Save, Send, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/store/authStore";

interface MailSettings {
  mail_host: string;
  mail_port: string;
  mail_secure: string;
  mail_user: string;
  mail_password: string;
  mail_from_name: string;
  mail_from_address: string;
}

type EncryptionMode = "starttls" | "ssl" | "none";

const encryptionOptions: { value: EncryptionMode; label: string; port: string; secure: string }[] = [
  { value: "starttls", label: "STARTTLS (587)", port: "587", secure: "false" },
  { value: "ssl",      label: "SSL/TLS (465)",  port: "465", secure: "true"  },
  { value: "none",     label: "Keine (25)",      port: "25",  secure: "false" },
];

function encryptionFromSettings(port: string, secure: string): EncryptionMode {
  if (secure === "true") return "ssl";
  if (port === "25") return "none";
  return "starttls";
}

export function MailserverView() {
  const { adminFetch } = useAuth();
  const [form, setForm] = useState<MailSettings>({
    mail_host: "", mail_port: "587", mail_secure: "false",
    mail_user: "", mail_password: "", mail_from_name: "GAIO Analyzer",
    mail_from_address: "",
  });
  const [editedPassword, setEditedPassword] = useState<string | undefined>(undefined);
  const [encryption, setEncryption] = useState<EncryptionMode>("starttls");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [testResult, setTestResult] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const res = await adminFetch("/api/admin/settings/mail");
    if (res.ok) {
      const data: MailSettings = await res.json();
      setForm(data);
      setEncryption(encryptionFromSettings(data.mail_port, data.mail_secure));
    }
    setLoading(false);
  }

  function handleEncryptionChange(mode: EncryptionMode) {
    const opt = encryptionOptions.find((o) => o.value === mode)!;
    setEncryption(mode);
    setForm((f) => ({ ...f, mail_port: opt.port, mail_secure: opt.secure }));
  }

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    const body: Record<string, string> = { ...form };
    if (editedPassword !== undefined) body.mail_password = editedPassword;
    else delete body.mail_password;

    const res = await adminFetch("/api/admin/settings/mail", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      setFeedback({ type: "ok", msg: "Einstellungen gespeichert" });
      setEditedPassword(undefined);
      setTimeout(() => setFeedback(null), 3500);
    } else {
      setFeedback({ type: "err", msg: "Fehler beim Speichern" });
    }
  }

  async function handleTestMail() {
    setTesting(true);
    setTestResult(null);
    const res = await adminFetch("/api/admin/settings/test-mail", { method: "POST" });
    const data = await res.json() as { success: boolean; error?: string; fallback?: boolean };
    setTesting(false);
    if (data.success && !data.fallback) {
      setTestResult({ type: "ok", msg: "Testmail erfolgreich gesendet" });
    } else if (data.success && data.fallback) {
      setTestResult({ type: "ok", msg: "Kein Mailserver konfiguriert — E-Mail wurde im Server-Log protokolliert" });
    } else {
      setTestResult({ type: "err", msg: data.error ?? "Testmail fehlgeschlagen" });
    }
    setTimeout(() => setTestResult(null), 5000);
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
        <h1 className="text-2xl font-bold tracking-tight">Mailserver</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          SMTP-Konfiguration für ausgehende E-Mails
        </p>
      </div>

      <div className="rounded-lg border p-5 space-y-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* SMTP Host */}
          <div className="sm:col-span-2 space-y-1.5">
            <label className="text-sm font-medium">SMTP-Host</label>
            <input
              type="text"
              value={form.mail_host}
              placeholder="smtp.gmail.com"
              onChange={(e) => setForm((f) => ({ ...f, mail_host: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>

          {/* Encryption */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Verschlüsselung</label>
            <select
              value={encryption}
              onChange={(e) => handleEncryptionChange(e.target.value as EncryptionMode)}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
            >
              {encryptionOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Port (read-only display, driven by encryption select) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Port</label>
            <input
              type="number"
              value={form.mail_port}
              onChange={(e) => setForm((f) => ({ ...f, mail_port: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>

          {/* Username */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Benutzername</label>
            <input
              type="text"
              value={form.mail_user}
              onChange={(e) => setForm((f) => ({ ...f, mail_user: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Passwort</label>
            <input
              type="password"
              value={editedPassword ?? form.mail_password}
              placeholder={form.mail_password ? "••••••••••••" : ""}
              onFocus={(e) => { if (editedPassword === undefined) { e.target.value = ""; setEditedPassword(""); } }}
              onChange={(e) => setEditedPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>

          {/* From Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Absendername</label>
            <input
              type="text"
              value={form.mail_from_name}
              onChange={(e) => setForm((f) => ({ ...f, mail_from_name: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>

          {/* From Address */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Absenderadresse</label>
            <input
              type="email"
              value={form.mail_from_address}
              onChange={(e) => setForm((f) => ({ ...f, mail_from_address: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Einstellungen speichern
          </button>

          <button
            onClick={() => void handleTestMail()}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))", background: "transparent" }}
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Testmail senden
          </button>
        </div>

        {feedback && (
          <div className={`flex items-center gap-2 text-sm ${feedback.type === "ok" ? "text-green-400" : "text-red-400"}`}>
            {feedback.type === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {feedback.msg}
          </div>
        )}
        {testResult && (
          <div className={`flex items-center gap-2 text-sm ${testResult.type === "ok" ? "text-green-400" : "text-red-400"}`}>
            {testResult.type === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {testResult.msg}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-md p-4 text-sm" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
        Ohne konfigurierten Mailserver werden E-Mails als Konsolenausgabe protokolliert.
        Funktionen wie Nutzer-Einladungen und Bestätigungscodes sind dann nur im Server-Log verfügbar.
      </div>
    </div>
  );
}
