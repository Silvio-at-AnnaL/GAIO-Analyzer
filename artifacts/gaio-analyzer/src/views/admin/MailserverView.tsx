import { useState, useEffect } from "react";
import { Save, Send, CheckCircle, AlertCircle, Loader2, Eye, EyeOff, Database, Info } from "lucide-react";
import { adminFetch, useAuth } from "@/store/authStore";
import { useT } from "@/lib/LabelProvider";
import type { DatabaseStatus } from "@workspace/api-client-react";

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

type DbStatus = DatabaseStatus;

// ── Component ─────────────────────────────────────────────────────────────────

export function MailserverView() {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
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
  const [dbTesting,    setDbTesting]    = useState(false);
  const [dbTestResult, setDbTestResult] = useState<{ ok: boolean; ms?: number; error?: string } | null>(null);

  useEffect(() => {
    void loadMail();
    if (isAdmin) void loadDb();
  }, [isAdmin]);

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
      }
    } catch {
      setDbStatus(null);
    } finally {
      setDbLoading(false);
    }
  }

  async function handleDbTest() {
    setDbTesting(true);
    setDbTestResult(null);
    try {
      const res = await adminFetch("/api/admin/settings/database/test", { method: "POST" });
      const data = await res.json() as { ok: boolean; ms?: number };
      setDbTestResult({ ok: res.ok && data.ok, ms: data.ms });
      if (res.ok) setDbStatus(current => current ? {
        ...current, connected: data.ok, latencyMs: data.ms ?? 0,
      } : null);
    } catch {
      setDbTestResult({ ok: false });
    } finally {
      setDbTesting(false);
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
        <h1 className="text-2xl font-bold tracking-tight">{t("nav.server")}</h1>
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
      {isAdmin && <div className="rounded-lg border p-5 space-y-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-4 h-4" style={{ color: "hsl(var(--muted-foreground))" }} />
          <span className="text-sm font-semibold">{t("mail.db_title")}</span>
        </div>

        {dbLoading ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> {t("mail.db_loading")}
          </div>
        ) : dbStatus ? (
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {([
                ["mail.db_source", t(`mail.db_source_${dbStatus.source}`)],
                ["mail.db_host", dbStatus.host],
                ["mail.db_port", dbStatus.port],
                ["mail.db_database", dbStatus.database],
                ["mail.db_user", dbStatus.user],
                ["mail.db_sslmode", dbStatus.sslmode ?? t("mail.db_not_specified")],
                ["mail.db_latency", t("mail.db_latency_value", { ms: dbStatus.latencyMs })],
              ] as const).map(([label, value]) => (
                <div key={label}>
                  <dt style={{ color: "hsl(var(--muted-foreground))" }}>{t(label)}</dt>
                  <dd className="font-mono break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className={`flex items-center gap-1.5 text-sm ${dbStatus.connected ? "text-green-500" : "text-amber-500"}`}>
              {dbStatus.connected ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {t(dbStatus.connected ? "mail.db_connected" : "mail.db_no_connection")}
            </div>
            <button onClick={() => void handleDbTest()} disabled={dbTesting}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border disabled:opacity-50">
              {dbTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
              {t("mail.db_test_button")}
            </button>
            {dbTestResult && (
              <div role="status" className={`text-sm ${dbTestResult.ok ? "text-green-500" : "text-red-400"}`}>
                {dbTestResult.ok ? t("mail.db_test_ok", { ms: dbTestResult.ms ?? 0 }) : t("mail.db_test_error")}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            {t("mail.db_status_error")}
          </div>
        )}

        {/* Platform hint */}
        <div className="pt-2 text-xs border-t" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          <Info className="w-3.5 h-3.5 inline mr-1" />
          {t("mail.db_config_hint")}
        </div>
      </div>}
    </div>
  );
}
