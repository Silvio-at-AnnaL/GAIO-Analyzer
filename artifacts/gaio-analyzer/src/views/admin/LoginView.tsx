import { useState } from "react";
import { useAuth, adminFetch } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { useT } from "@/lib/LabelProvider";

export function LoginView() {
  const t = useT();
  const { isAuthenticated, login, setPendingChangeUsername } = useAuth();
  const { setActiveView } = useAppStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  if (isAuthenticated) {
    return (
      <div className="max-w-md mx-auto mt-16 space-y-4">
        <h1 className="text-2xl font-bold">{t("auth.already_logged_in_title")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.already_logged_in_text")}</p>
        <button
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          onClick={() => setActiveView(7)}
        >
          {t("auth.go_to_profile_button")}
        </button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? t("auth.login_failed")); return; }
      if (data.mustChangePw) {
        setPendingChangeUsername(username);
        setActiveView(8);
        return;
      }
      login(data.user);
      setActiveView(7);
    } catch {
      setError(t("auth.network_error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="p-8 rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <h1 className="text-2xl font-bold mb-1">{t("auth.login_title")}</h1>
        <p className="text-sm text-muted-foreground mb-6">{t("auth.login_subtitle")}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("auth.username_label")}</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="username" required
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("auth.password_label")}</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password" required
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold disabled:opacity-60"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            {loading ? t("auth.login_button_loading") : t("auth.login_button")}
          </button>
        </form>
      </div>
    </div>
  );
}
