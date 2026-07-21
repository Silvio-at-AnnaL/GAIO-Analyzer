import { useState, useEffect } from "react";
import { Save, Send, CheckCircle, AlertCircle, Loader2, Eye, EyeOff, Database, Info } from "lucide-react";
import { adminFetch } from "@/store/authStore";
import { useT } from "@/lib/LabelProvider";

// ── Mail settings ─────────────────────────────────────────────────────────────

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
  { value: "starttls", label: "mail.enc_starttls", port: "587", secure: "false" },
  { value: "ssl",      label: "mail.enc_ssl",      port: "465", secure: "true"  },
  { value: "none",     label: "mail.enc_none",     port: "25",  secure: "false" },
];

function encryptionFromSettings(port: string, secure: string): EncryptionMode {
  if (secure === "true") return "ssl";
  if (port === "25") return "none";
  return "starttls";
}

// ── Database status ───────────────────────────────────────────────────────────

interface DbStatus {
  source:     "env" | "bootstrap" | "default";
  maskedUrl:  string;
  connected:  boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MailserverView() {
  const t = useT();
  // ── Mail state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState<MailSettings>({
    mail_host: "", mail_port: "587", mail_secure: "false",
    mail_user: "", mail_password: "", mail_from_name: "GAIO Analyzer",
    mail_from_address: "",
  });
  const [editedPassword, setEditedPassword] = useState<string | undefined>(undefined);
  const [encryption, setEncryption]         = useState<EncryptionMode>("starttls");
  const [loading,    setLoading]            = useState(true);
  const [saving,     setSaving]             = useState(false);
  const [testing,    setTesting]            = useState(false);
  const [feedback,   setFeedback]           = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [testResult, setTestResult]         = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  // ── DB state ────────────────────────────────────────────────────────────────
  const [dbStatus,     setDbStatus]     = useState<DbStatus | null>(null);
  const [dbLoading,    setDbLoading]    = useState(true);
  const [dbConnStr,    setDbConnStr]    = useState("");
  const [dbEdited,     setDbEdited]     = useState(false);
  const [dbShowPw,     setDbShowPw]     = useState(false);
  const [dbFormOpen,   setDbFormOpen]   = useState(false);
  const [dbTesting,    setDbTesting]    = useState(false);
  const [dbTestResult, setDbTestResult] = useState<{ ok: boolean; ms?: number; error?: string } | null>(null);
  const [dbSaving,     setDbSaving]     = useState(false);
  const [dbSaved,      setDbSaved]      = useState(false);

  useEffect(() => {
    void Promise.all([loadMail(), loadDb()]);
  }, []);

  // ── Mail handlers ────────────────────────────────────────────────────────────

  async function loadMail() {
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
      setFeedback({ type: "ok", msg: t("delivery.saved_msg") });
      setEditedPassword(undefined);
      setTimeout(() => setFeedback(null), 3500);
    } else {
      setFeedback({ type: "err", msg: t("delivery.save_error") });
    }
  }

  async function handleTestMail() {
    setTesting(true);
    setTestResult(null);
    const res = await adminFetch("/api/admin/settings/test-mail", { method: "POST" });
    const data = await res.json() as { success: boolean; error?: string; fallback?: boolean };
    setTesting(false);
    if (data.success && !data.fallback) {
      setTestResult({ type: "ok", msg: t("mail.test_success") });
    } else if (data.success && data.fallback) {
      setTestResult({ type: "ok", msg: t("mail.test_logged") });
    } else {
      setTestResult({ type: "err", msg: data.error ?? t("mail.test_failed") });
    }
    setTimeout(() => setTestResult(null), 5000);
  }

  // ── DB handlers ──────────────────────────────────────────────────────────────

  async function loadDb() {
    setDbLoading(true);
    try {
      const res = await adminFetch("/api/admin/settings/database");
      if (res.ok) {
        const data: DbStatus = await res.json();
        setDbStatus(data);
        if (data.source === "default") setDbFormOpen(true);
      }
    } finally {
      setDbLoading(false);
    }
  }

  async function handleDbTest() {
    setDbTesting(true);
    setDbTestResult(null);
    const body = dbEdited ? { connectionString: dbConnStr } : {};
    const res = await adminFetch("/api/admin/settings/database/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json() as { ok: boolean; ms?: number; error?: string };
    setDbTesting(false);
    setDbTestResult(data);
  }

  async function handleDbSave() {
    if (!dbConnStr.trim()) return;
    setDbSaving(true);
    setDbSaved(false);
    const res = await adminFetch("/api/admin/settings/database", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionString: dbConnStr.trim() }),
    });
    setDbSaving(false);
    if (res.ok) {
      setDbSaved(true);
      setDbEdited(false);
      setTimeout(() => setDbSaved(false), 3500);
      void loadDb();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading && dbLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--muted-foreground))" }} />
      </div>
    );
  }

  const inputStyle = {
    background: "hsl(var(--input))",
    borderColor: "hsl(var(--border))",
    color: "hsl(var(--foreground))",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Server</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          {t("mail.subtitle")}
        </p>
      </div>

      {/* ── Mail card ─────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border p-5 space-y-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="flex items-center gap-2 mb-1">
          <Send className="w-4 h-4" style={{ color: "hsl(var(--muted-foreground))" }} />
          <span className="text-sm font-semibold">{t("mail.title")}</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-1.5">
            <label className="text-sm font-medium">{t("mail.host_label")}</label>
            <input
              type="text"
              value={form.mail_host}
              placeholder="smtp.gmail.com"
              onChange={(e) => setForm((f) => ({ ...f, mail_host: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={inputStyle}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("mail.encryption_label")}</label>
            <select
              value={encryption}
              onChange={(e) => handleEncryptionChange(e.target.value as EncryptionMode)}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={inputStyle}
            >
              {encryptionOptions.map((o) => (
                <option key={o.value} value={o.value}>{t(o.label)}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("mail.port_label")}</label>
            <input
              type="number"
              value={form.mail_port}
              onChange={(e) => setForm((f) => ({ ...f, mail_port: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={inputStyle}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("auth.username_label")}</label>
            <input
              type="text"
              value={form.mail_user}
              onChange={(e) => setForm((f) => ({ ...f, mail_user: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={inputStyle}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("auth.password_label")}</label>
            <input
              type="password"
              value={editedPassword ?? form.mail_password}
              placeholder={form.mail_password ? "••••••••••••" : ""}
              onFocus={(e) => { if (editedPassword === undefined) { e.target.value = ""; setEditedPassword(""); } }}
              onChange={(e) => setEditedPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={inputStyle}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("mail.from_name_label")}</label>
            <input
              type="text"
              value={form.mail_from_name}
              onChange={(e) => setForm((f) => ({ ...f, mail_from_name: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={inputStyle}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("mail.from_address_label")}</label>
            <input
              type="email"
              value={form.mail_from_address}
              onChange={(e) => setForm((f) => ({ ...f, mail_from_address: e.target.value }))}
              className="w-full px-3 py-2 rounded-md text-sm border"
              style={inputStyle}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t("delivery.save_button")}
          </button>

          <button
            onClick={() => void handleTestMail()}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))", background: "transparent" }}
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {t("mail.test_button")}
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

      <div className="rounded-md p-4 text-sm" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
        {t("mail.hint_box")}
      </div>

      {/* ── Database card ──────────────────────────────────────────────────────── */}
      <div className="rounded-lg border p-5 space-y-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-4 h-4" style={{ color: "hsl(var(--muted-foreground))" }} />
          <span className="text-sm font-semibold">Datenbankverbindung</span>
        </div>

        {dbLoading ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Lade Status…
          </div>
        ) : dbStatus ? (
          <>
            {/* ENV source — read-only info */}
            {dbStatus.source === "env" && (
              <div className="rounded-md p-4 space-y-2" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "#1d4ed8" }}>
                  <Info className="w-4 h-4 shrink-0" />
                  Verbindung über Umgebungsvariable DATABASE_URL konfiguriert.
                </div>
                {dbStatus.maskedUrl && (
                  <div className="font-mono text-xs break-all" style={{ color: "#4b5563" }}>
                    {dbStatus.maskedUrl}
                  </div>
                )}
                <div className="text-xs" style={{ color: "#6b7280" }}>
                  Umgebungsvariablen haben Vorrang. Auf Replit: Replit Secrets verwenden.
                </div>
              </div>
            )}

            {/* BOOTSTRAP or DEFAULT source — editable */}
            {(dbStatus.source === "bootstrap" || dbStatus.source === "default") && (
              <div className="space-y-3">
                {/* Current connection status */}
                <div className="space-y-1">
                  <div className="text-xs font-medium uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aktuelle Verbindung
                  </div>
                  {dbStatus.maskedUrl ? (
                    <div className="font-mono text-xs break-all" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {dbStatus.maskedUrl}
                    </div>
                  ) : (
                    <div className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>—</div>
                  )}
                  <div className={`flex items-center gap-1.5 text-xs ${dbStatus.connected ? "text-green-500" : "text-amber-500"}`}>
                    {dbStatus.connected
                      ? <><CheckCircle className="w-3.5 h-3.5" /> Verbunden</>
                      : <><AlertCircle className="w-3.5 h-3.5" />
                          {dbStatus.source === "default"
                            ? "Standardverbindung aktiv — bitte eigene Zugangsdaten hinterlegen."
                            : "Keine aktive Verbindung"}
                        </>
                    }
                  </div>
                </div>

                {/* Toggle form when not default */}
                {dbStatus.source === "bootstrap" && !dbFormOpen && (
                  <button
                    onClick={() => setDbFormOpen(true)}
                    className="text-xs underline"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    Connection String ändern
                  </button>
                )}

                {/* Edit form */}
                {dbFormOpen && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">PostgreSQL Connection String</label>
                      <div className="relative">
                        <input
                          type={dbShowPw ? "text" : "password"}
                          value={dbEdited ? dbConnStr : dbStatus.maskedUrl}
                          placeholder="postgresql://user:pass@host/db?sslmode=require"
                          onFocus={() => { if (!dbEdited) { setDbConnStr(""); setDbEdited(true); } }}
                          onChange={(e) => { setDbConnStr(e.target.value); setDbEdited(true); }}
                          className="w-full px-3 py-2 pr-10 rounded-md text-sm border font-mono"
                          style={inputStyle}
                        />
                        <button
                          type="button"
                          onClick={() => setDbShowPw((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                          tabIndex={-1}
                        >
                          {dbShowPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Format: postgresql://[user]:[passwort]@[host]/[datenbank]?sslmode=require
                        {" · "}Kostenlose Datenbank: <a href="https://neon.tech" target="_blank" rel="noopener noreferrer" style={{ color: "hsl(var(--primary))" }}>neon.tech</a>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void handleDbTest()}
                        disabled={dbTesting}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border disabled:opacity-50"
                        style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))", background: "transparent" }}
                      >
                        {dbTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                        Verbindung testen
                      </button>

                      <button
                        onClick={() => void handleDbSave()}
                        disabled={dbSaving || !dbEdited || !dbConnStr.trim()}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 ml-auto"
                        style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
                      >
                        {dbSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Speichern
                      </button>
                    </div>

                    {dbTestResult && (
                      <div className={`flex items-center gap-2 text-sm ${dbTestResult.ok ? "text-green-500" : "text-red-400"}`}>
                        {dbTestResult.ok
                          ? <><CheckCircle className="w-4 h-4 shrink-0" /> Verbindung OK ({dbTestResult.ms} ms)</>
                          : <><AlertCircle className="w-4 h-4 shrink-0" /> Verbindungsfehler: {dbTestResult.error}</>
                        }
                      </div>
                    )}

                    {dbSaved && (
                      <div className="flex items-center gap-2 text-sm text-green-500">
                        <CheckCircle className="w-4 h-4 shrink-0" /> Gespeichert.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            Status konnte nicht geladen werden.
          </div>
        )}

        {/* Platform hint */}
        <div className="pt-2 text-xs border-t" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          Auf Replit: DATABASE_URL in den Replit Secrets eintragen — hat automatisch Vorrang und bleibt nach Neustarts erhalten.
          Auf eigenem Server: dieses Formular oder Umgebungsvariable DATABASE_URL.
        </div>
      </div>
    </div>
  );
}
