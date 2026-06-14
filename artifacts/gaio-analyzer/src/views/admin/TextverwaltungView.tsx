import { useState, useEffect } from "react";
import { Save, RotateCcw } from "lucide-react";
import { adminFetch } from "@/store/authStore";
import { labelDefaults, SUPPORTED_LOCALES, type Locale } from "@/lib/labelDefaults";

const GROUPED = Object.entries(labelDefaults).reduce<Record<string, string[]>>((acc, [key, def]) => {
  (acc[def.group] ??= []).push(key);
  return acc;
}, {});

export function TextverwaltungView() {
  const [locale, setLocale] = useState<Locale>("en");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    adminFetch(`/api/admin/labels?locale=${locale}`)
      .then((r) => r.json())
      .then((data: { overrides: Record<string, string> }) => {
        setOverrides(data.overrides ?? {});
        setMsg(null);
      })
      .catch(() => {});
  }, [locale]);

  useEffect(() => {
    if (selectedKey !== null) {
      setEditorValue(overrides[selectedKey] ?? "");
      setMsg(null);
    }
  }, [selectedKey, overrides]);

  async function handleSave() {
    if (!selectedKey) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await adminFetch(`/api/admin/labels/${encodeURIComponent(selectedKey)}`, {
        method: "PATCH",
        body: JSON.stringify({ locale, value: editorValue }),
      });
      if (r.ok) {
        setOverrides((prev) => ({ ...prev, [selectedKey]: editorValue }));
        setMsg("Gespeichert");
      } else {
        setMsg("Fehler beim Speichern");
      }
    } catch {
      setMsg("Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!selectedKey) return;
    setResetting(true);
    setMsg(null);
    try {
      const r = await adminFetch(`/api/admin/labels/${encodeURIComponent(selectedKey)}/reset`, {
        method: "POST",
        body: JSON.stringify({ locale }),
      });
      if (r.ok) {
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[selectedKey];
          return next;
        });
        setEditorValue("");
        setMsg("Override entfernt");
      }
    } catch {
      setMsg("Fehler beim Zurücksetzen");
    } finally {
      setResetting(false);
    }
  }

  const searchLower = search.toLowerCase();
  const filteredGrouped = Object.entries(GROUPED).reduce<Record<string, string[]>>(
    (acc, [grp, keys]) => {
      const filtered = keys.filter(
        (k) =>
          !searchLower ||
          k.toLowerCase().includes(searchLower) ||
          (labelDefaults[k]?.de ?? "").toLowerCase().includes(searchLower),
      );
      if (filtered.length) acc[grp] = filtered;
      return acc;
    },
    {},
  );

  const deSource = selectedKey ? (labelDefaults[selectedKey]?.de ?? "") : "";
  const hasOverride = selectedKey !== null && selectedKey in overrides;
  const isDirty = selectedKey !== null && editorValue !== (overrides[selectedKey] ?? "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%", minHeight: "calc(100vh - 120px)" }}>

      {/* Locale selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "0.8rem", color: "hsl(var(--muted-foreground))", marginRight: 4 }}>
          Sprache bearbeiten:
        </span>
        {SUPPORTED_LOCALES.map((l) => (
          <button
            key={l}
            onClick={() => setLocale(l)}
            style={{
              padding: "4px 14px",
              borderRadius: 6,
              border: `1.5px solid ${locale === l ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
              background: locale === l ? "hsl(var(--primary))" : "transparent",
              color: locale === l ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
              fontWeight: locale === l ? 600 : 400,
              fontSize: "0.8rem",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex gap-6" style={{ flex: 1, minHeight: 0 }}>

        {/* ── Left panel: key list ─────────────────────────────────────────────── */}
        <div
          className="w-64 flex-shrink-0 rounded-lg border overflow-y-auto"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
            <h2 className="text-sm font-semibold mb-2" style={{ color: "hsl(var(--foreground))" }}>
              Textverwaltung
            </h2>
            <input
              type="text"
              placeholder="Suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "5px 8px",
                borderRadius: 5,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontSize: "0.8rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div className="py-2">
            {Object.entries(filteredGrouped).map(([grp, keys]) => (
              <div key={grp}>
                <div
                  className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  {grp}
                </div>
                {keys.map((k) => (
                  <button
                    key={k}
                    onClick={() => setSelectedKey(k)}
                    className="w-full text-left px-4 py-2.5 transition-colors"
                    style={{
                      background: selectedKey === k ? "hsl(var(--accent))" : "transparent",
                      color:
                        selectedKey === k
                          ? "hsl(var(--accent-foreground))"
                          : "hsl(var(--foreground))",
                      borderLeft:
                        selectedKey === k
                          ? "3px solid hsl(var(--primary))"
                          : "3px solid transparent",
                    }}
                  >
                    <div className="text-sm font-medium leading-tight">
                      {k.split(".").slice(1).join(".")}
                    </div>
                    {k in overrides && (
                      <div className="text-xs mt-0.5" style={{ color: "hsl(var(--chart-4))" }}>
                        Angepasst
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ── Right panel: editor ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {!selectedKey && (
            <div
              className="flex-1 rounded-lg border flex items-center justify-center"
              style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
            >
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                Wählen Sie einen Text-Schlüssel aus der linken Liste
              </p>
            </div>
          )}

          {selectedKey && (
            <>
              {/* Header */}
              <div
                className="rounded-lg border px-5 py-4"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                      {selectedKey}
                    </h3>
                    <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Sprache: <strong>{locale.toUpperCase()}</strong>
                      {hasOverride && (
                        <span style={{ marginLeft: 8, color: "hsl(var(--chart-4))" }}>· Override aktiv</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {hasOverride && (
                      <button
                        onClick={handleReset}
                        disabled={resetting}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border transition-colors"
                        style={{
                          borderColor: "hsl(var(--border))",
                          color: "hsl(var(--muted-foreground))",
                        }}
                      >
                        <RotateCcw size={14} />
                        {resetting ? "…" : "Zurücksetzen"}
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
                      {saving ? "Speichert…" : "Speichern"}
                    </button>
                  </div>
                </div>
                {msg && (
                  <p
                    className="text-xs mt-2"
                    style={{
                      color: msg.startsWith("Fehler")
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--chart-2))",
                    }}
                  >
                    {msg}
                  </p>
                )}
              </div>

              {/* German source (read-only reference) */}
              <div
                className="rounded-lg border px-5 py-3"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              >
                <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Quelle (Deutsch — Standard)
                </div>
                <p className="text-sm" style={{ color: "hsl(var(--foreground))", lineHeight: 1.55 }}>
                  {deSource}
                </p>
              </div>

              {/* Override editor */}
              <div
                className="rounded-lg border flex flex-col"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              >
                <div
                  className="flex items-center justify-between px-4 py-2 border-b"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Override für {locale.toUpperCase()}
                  </span>
                  {isDirty && (
                    <span className="text-xs" style={{ color: "hsl(var(--chart-4))" }}>
                      Nicht gespeichert
                    </span>
                  )}
                </div>
                <textarea
                  value={editorValue}
                  onChange={(e) => setEditorValue(e.target.value)}
                  placeholder={`Übersetzung / Override auf ${locale.toUpperCase()} eingeben…`}
                  spellCheck={false}
                  className="flex-1 resize-none p-4 text-sm focus:outline-none"
                  style={{
                    background: "transparent",
                    color: "hsl(var(--foreground))",
                    minHeight: 120,
                    lineHeight: 1.6,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
