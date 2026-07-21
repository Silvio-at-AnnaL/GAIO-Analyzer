import { useState, useEffect } from "react";
import { Check, X } from "lucide-react";
import { useAuth, adminFetch } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { useT } from "@/lib/LabelProvider";

const POLICY_CHECKS = [
  { label: "auth.policy_min_length",  test: (p: string) => p.length >= 10 },
  { label: "auth.policy_uppercase",   test: (p: string) => /[A-Z]/.test(p) },
  { label: "auth.policy_lowercase",   test: (p: string) => /[a-z]/.test(p) },
  { label: "auth.policy_digit",       test: (p: string) => /[0-9]/.test(p) },
  { label: "auth.policy_special",     test: (p: string) => /[!@#$%^&*()\-_=+\[\]{}|;':",.<>?/~`]/.test(p) },
];

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-sm"
        style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-6 rounded-xl space-y-4" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </div>
  );
}

export function ProfileView() {
  const t = useT();
  const { user, isAuthenticated, isLoading, logout, refreshUser } = useAuth();
  const { setActiveView } = useAppStore();

  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [nameMsg,   setNameMsg]   = useState("");
  const [nameSaving, setNameSaving] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [currentPwU,  setCurrentPwU] = useState("");
  const [usernameMsg, setUsernameMsg] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);

  const [newEmail,   setNewEmail]  = useState("");
  const [emailMsg,   setEmailMsg]  = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [inlineCode,  setInlineCode] = useState<string | null>(null);
  const [verifyCode,  setVerifyCode] = useState("");
  const [verifyMsg,   setVerifyMsg] = useState("");

  const [currentPw,  setCurrentPw] = useState("");
  const [newPw,      setNewPw]     = useState("");
  const [confirmPw,  setConfirm]   = useState("");
  const [pwMsg,      setPwMsg]     = useState("");
  const [pwSaving,   setPwSaving]  = useState(false);

  useEffect(() => {
    if (user) { setFirstName(user.firstName); setLastName(user.lastName); }
  }, [user]);

  if (isLoading) return <div className="p-8 text-muted-foreground text-sm">{t("profile.loading")}</div>;
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto mt-16 space-y-4">
        <p className="text-muted-foreground">{t("profile.not_logged_in")}</p>
        <button className="text-sm underline text-primary" onClick={() => setActiveView(7)}>{t("auth.go_to_login_button")}</button>
      </div>
    );
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault(); setNameMsg(""); setNameSaving(true);
    const res = await adminFetch("/api/admin/profile", { method: "PATCH", body: JSON.stringify({ firstName, lastName }) });
    const data = await res.json();
    setNameSaving(false);
    if (res.ok) { await refreshUser(); setNameMsg(t("profile.msg_saved")); }
    else setNameMsg(data.error ?? t("profile.error_generic"));
  }

  async function saveUsername(e: React.FormEvent) {
    e.preventDefault(); setUsernameMsg(""); setUsernameSaving(true);
    const res = await adminFetch("/api/admin/profile", { method: "PATCH", body: JSON.stringify({ newUsername, currentPassword: currentPwU }) });
    const data = await res.json();
    setUsernameSaving(false);
    if (res.ok) { await refreshUser(); setNewUsername(""); setCurrentPwU(""); setUsernameMsg(t("profile.msg_username_updated")); }
    else setUsernameMsg(data.error ?? t("profile.error_generic"));
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault(); setEmailMsg(""); setEmailSaving(true); setInlineCode(null);
    const res = await adminFetch("/api/admin/profile", { method: "PATCH", body: JSON.stringify({ newEmail }) });
    const data = await res.json();
    setEmailSaving(false);
    if (res.ok) {
      if (data.requiresVerification) {
        setAwaitingCode(true);
        if (data.code) {
          setInlineCode(data.code);
          setEmailMsg(t("profile.no_mailserver"));
        } else {
          setEmailMsg(t("profile.code_sent"));
        }
      } else { await refreshUser(); setNewEmail(""); setEmailMsg(t("profile.msg_email_updated")); }
    } else setEmailMsg(data.error ?? t("profile.error_generic"));
  }

  async function verifyEmailCode(e: React.FormEvent) {
    e.preventDefault(); setVerifyMsg("");
    const res = await adminFetch("/api/admin/verify-code", { method: "POST", body: JSON.stringify({ code: verifyCode, purpose: "email_change" }) });
    const data = await res.json();
    if (res.ok) { await refreshUser(); setAwaitingCode(false); setNewEmail(""); setVerifyCode(""); setInlineCode(null); setEmailMsg(t("profile.msg_email_changed")); }
    else setVerifyMsg(data.error ?? t("profile.invalid_code"));
  }

  const allPolicyMet = POLICY_CHECKS.every(c => c.test(newPw));
  async function savePassword(e: React.FormEvent) {
    e.preventDefault(); setPwMsg("");
    if (newPw !== confirmPw) { setPwMsg(t("auth.pw_mismatch")); return; }
    if (!allPolicyMet) { setPwMsg(t("auth.policy_not_met")); return; }
    setPwSaving(true);
    const res = await adminFetch("/api/admin/profile", { method: "PATCH", body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }) });
    const data = await res.json();
    setPwSaving(false);
    if (res.ok) { setCurrentPw(""); setNewPw(""); setConfirm(""); setPwMsg(t("profile.msg_password_changed")); }
    else setPwMsg(data.error ?? t("profile.error_generic"));
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Profil</h1>
          <p className="text-sm text-muted-foreground">{user?.role === "admin" ? "Administrator" : user?.role === "user_extended" ? "Erweiterter Benutzer" : "Benutzer"}</p>
        </div>
        <button onClick={async () => { await logout(); setActiveView(7); }}
          className="text-sm px-4 py-2 rounded-lg"
          style={{ border: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          Abmelden
        </button>
      </div>

      {/* Personal data */}
      <Section title="Persönliche Daten">
        <form onSubmit={saveName} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Vorname" value={firstName} onChange={setFirstName} />
            <Field label="Nachname" value={lastName}  onChange={setLastName} />
          </div>
          {nameMsg && <p className="text-sm" style={{ color: nameMsg.startsWith("✓") ? "hsl(var(--primary))" : "hsl(var(--destructive))" }}>{nameMsg}</p>}
          <button type="submit" disabled={nameSaving}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            {nameSaving ? "Speichern…" : "Speichern"}
          </button>
        </form>
      </Section>

      {/* Username */}
      <Section title="Benutzername ändern">
        <form onSubmit={saveUsername} className="space-y-4">
          <Field label="Aktueller Benutzername" value={user?.username ?? ""} onChange={() => {}} />
          <Field label="Neuer Benutzername" value={newUsername} onChange={setNewUsername} />
          <Field label="Aktuelles Passwort zur Bestätigung" value={currentPwU} onChange={setCurrentPwU} type="password" />
          {usernameMsg && <p className="text-sm" style={{ color: usernameMsg.startsWith("✓") ? "hsl(var(--primary))" : "hsl(var(--destructive))" }}>{usernameMsg}</p>}
          <button type="submit" disabled={usernameSaving || !newUsername || !currentPwU}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            {usernameSaving ? "Speichern…" : "Benutzername ändern"}
          </button>
        </form>
      </Section>

      {/* Email */}
      <Section title="E-Mail ändern">
        <form onSubmit={saveEmail} className="space-y-4">
          <Field label="Aktuelle E-Mail" value={user?.email ?? ""} onChange={() => {}} type="email" />
          <Field label="Neue E-Mail" value={newEmail} onChange={setNewEmail} type="email" />
          {emailMsg && <p className="text-sm" style={{ color: emailMsg.startsWith("✓") ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>{emailMsg}</p>}
          {inlineCode && (
            <div className="rounded-lg p-4 space-y-1" style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--primary) / 0.4)" }}>
              <p className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Ihr Bestätigungscode (15 Min. gültig):</p>
              <p className="text-3xl font-mono font-bold tracking-widest" style={{ color: "hsl(var(--primary))" }}>{inlineCode}</p>
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Geben Sie diesen Code im Feld unten ein.</p>
            </div>
          )}
          {!awaitingCode && (
            <button type="submit" disabled={emailSaving || !newEmail}
              className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
              style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
              {emailSaving ? "Senden…" : "Bestätigungscode senden"}
            </button>
          )}
        </form>
        {awaitingCode && (
          <form onSubmit={verifyEmailCode} className="space-y-3 mt-4 pt-4" style={{ borderTop: "1px solid hsl(var(--border))" }}>
            <label className="text-sm font-medium">Bestätigungscode (6 Ziffern)</label>
            <input type="text" inputMode="numeric" maxLength={6} value={verifyCode} onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-40 px-3 py-2 rounded-lg text-sm font-mono"
              style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            {verifyMsg && <p className="text-sm text-amber-400">{verifyMsg}</p>}
            <button type="submit" disabled={verifyCode.length !== 6}
              className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
              style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
              Code bestätigen
            </button>
          </form>
        )}
      </Section>

      {/* Password */}
      <Section title="Passwort ändern">
        <form onSubmit={savePassword} className="space-y-4">
          <Field label="Aktuelles Passwort" value={currentPw} onChange={setCurrentPw} type="password" />
          <Field label="Neues Passwort"     value={newPw}     onChange={setNewPw}     type="password" />
          {newPw && (
            <div className="space-y-1 p-3 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
              {POLICY_CHECKS.map(c => (
                <div key={c.label} className="flex items-center gap-2 text-xs">
                  {c.test(newPw) ? <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" /> : <X className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                  <span style={{ color: c.test(newPw) ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>{t(c.label)}</span>
                </div>
              ))}
            </div>
          )}
          <Field label="Passwort bestätigen" value={confirmPw} onChange={setConfirm} type="password" />
          {confirmPw && newPw !== confirmPw && <p className="text-xs text-amber-400">{t("auth.pw_mismatch")}</p>}
          {pwMsg && <p className="text-sm" style={{ color: pwMsg.startsWith("✓") ? "hsl(var(--primary))" : "hsl(var(--destructive))" }}>{pwMsg}</p>}
          <button type="submit" disabled={pwSaving || !currentPw || !allPolicyMet || newPw !== confirmPw}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            {pwSaving ? "Speichern…" : "Passwort ändern"}
          </button>
        </form>
      </Section>
    </div>
  );
}
