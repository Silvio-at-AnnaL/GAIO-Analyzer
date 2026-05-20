import { useState } from "react";
import { Check, X } from "lucide-react";
import { useAuth, adminFetch } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";

const POLICY_CHECKS = [
  { label: "Mindestens 10 Zeichen",       test: (p: string) => p.length >= 10 },
  { label: "Großbuchstabe (A–Z)",          test: (p: string) => /[A-Z]/.test(p) },
  { label: "Kleinbuchstabe (a–z)",         test: (p: string) => /[a-z]/.test(p) },
  { label: "Ziffer (0–9)",                 test: (p: string) => /[0-9]/.test(p) },
  { label: "Sonderzeichen (!@#$%…)",       test: (p: string) => /[!@#$%^&*()\-_=+\[\]{}|;':",.<>?/~`]/.test(p) },
];

export function ForcePasswordChangeView() {
  const { pendingChangeUsername, login } = useAuth();
  const { setActiveView } = useAppStore();

  const [tempPw,    setTempPw]  = useState("");
  const [newPw,     setNewPw]   = useState("");
  const [confirmPw, setConfirm] = useState("");
  const [error,     setError]   = useState("");
  const [loading,   setLoading] = useState(false);

  const allPolicyMet = POLICY_CHECKS.every(c => c.test(newPw));

  if (!pendingChangeUsername) {
    return (
      <div className="max-w-md mx-auto mt-16 space-y-4">
        <p className="text-sm text-muted-foreground">Keine aktive Passwort-Änderungssitzung. Bitte melden Sie sich zuerst an.</p>
        <button className="text-sm underline text-primary" onClick={() => setActiveView(7)}>Zum Login</button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPw !== confirmPw) { setError("Passwörter stimmen nicht überein"); return; }
    if (!allPolicyMet)       { setError("Bitte erfüllen Sie alle Passwortanforderungen"); return; }
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/set-initial-password", {
        method: "POST",
        body: JSON.stringify({ username: pendingChangeUsername, tempPassword: tempPw, newPassword: newPw, confirmPassword: confirmPw }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Fehler beim Setzen des Passworts"); return; }
      login(data.user);
      setActiveView(7);
    } catch {
      setError("Netzwerkfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="p-8 rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <h1 className="text-2xl font-bold mb-1">Passwort setzen</h1>
        <p className="text-sm text-muted-foreground mb-1">
          Anmeldung als <span className="font-mono font-semibold">{pendingChangeUsername}</span>
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          Bitte setzen Sie Ihr persönliches Passwort, um fortzufahren.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Temporäres Passwort</label>
            <input type="password" value={tempPw} onChange={e => setTempPw(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Neues Passwort</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
          </div>

          {newPw && (
            <div className="space-y-1 p-3 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
              {POLICY_CHECKS.map(c => (
                <div key={c.label} className="flex items-center gap-2 text-xs">
                  {c.test(newPw)
                    ? <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    : <X    className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                  <span style={{ color: c.test(newPw) ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
                    {c.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Passwort bestätigen</label>
            <input type="password" value={confirmPw} onChange={e => setConfirm(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            {confirmPw && newPw !== confirmPw && <p className="text-xs text-amber-400">Passwörter stimmen nicht überein</p>}
          </div>

          {error && <p className="text-sm text-amber-400">{error}</p>}

          <button type="submit" disabled={loading || !allPolicyMet || newPw !== confirmPw}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold disabled:opacity-60"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            {loading ? "Speichern…" : "Passwort setzen & anmelden"}
          </button>
        </form>
      </div>
    </div>
  );
}
