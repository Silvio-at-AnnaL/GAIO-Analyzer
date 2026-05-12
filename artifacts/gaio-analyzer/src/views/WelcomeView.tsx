import { useState } from "react";
import { Bot, Radar, ListChecks } from "lucide-react";
import { useAppStore } from "@/store/appStore";

interface WelcomeViewProps {
  onDismiss: () => void;
}

export function WelcomeView({ onDismiss }: WelcomeViewProps) {
  const { domainForm, setDomainForm } = useAppStore();
  const [urlInput, setUrlInput] = useState("");

  function handleStart() {
    const url = urlInput.trim();
    if (url) {
      setDomainForm({ ...domainForm, url });
    }
    onDismiss();
  }

  function handleKiPrefill() {
    const url = urlInput.trim();
    if (url) {
      setDomainForm({ ...domainForm, url });
    }
    onDismiss();
  }

  const DEMO_BARS = [
    { label: "Techn. SEO", value: 86, color: "#ef4444" },
    { label: "Schema.org", value: 8,  color: "#a855f7" },
    { label: "Inhalt",     value: 33, color: "#22c55e" },
    { label: "LLM",        value: 27, color: "#06b6d4" },
  ];

  return (
    <div style={{ maxWidth: 680 }}>

      {/* Section 1 — Eyebrow + Headline + Subline */}
      <div className="space-y-4 mb-10">
        <div className="flex items-center gap-3">
          <div style={{ width: 32, height: 1.5, background: "hsl(var(--primary))", flexShrink: 0 }} />
          <span style={{
            fontSize: "0.7rem",
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "hsl(var(--primary))",
          }}>
            KI-Sichtbarkeit &amp; SEO-Analyse
          </span>
        </div>

        <h1 style={{
          fontSize: "clamp(1.6rem, 3.5vw, 2.2rem)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
          margin: 0,
        }}>
          Wie gut findet{" "}
          <span style={{ color: "hsl(var(--primary))" }}>ChatGPT</span>
          {" "}Ihre Website?
        </h1>

        <p style={{
          fontSize: "0.95rem",
          color: "hsl(var(--muted-foreground))",
          lineHeight: 1.6,
          maxWidth: 520,
          margin: 0,
        }}>
          Der GAIO Analyzer untersucht Ihre B2B-Website auf LLM-Auffindbarkeit
          und klassische SEO-Grundlagen — und zeigt, was geändert werden muss,
          damit KI-Systeme Ihr Unternehmen empfehlen.
        </p>
      </div>

      {/* Section 2 — URL quick-entry */}
      <div className="mb-10">
        <div style={{ display: "flex", gap: "0.5rem", maxWidth: 560 }}>
          <input
            type="url"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleStart()}
            placeholder="https://www.ihre-website.de"
            style={{
              flex: 1,
              height: 42,
              padding: "0 0.875rem",
              borderRadius: "0.5rem",
              border: "1.5px solid hsl(var(--border))",
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              fontSize: "0.875rem",
              outline: "none",
            }}
          />
          <button
            onClick={handleStart}
            style={{
              height: 42,
              paddingLeft: "1.1rem",
              paddingRight: "1.1rem",
              borderRadius: "0.5rem",
              background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              fontWeight: 600,
              fontSize: "0.875rem",
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Analyse starten →
          </button>
        </div>

        <p style={{
          marginTop: "0.6rem",
          fontSize: "0.775rem",
          color: "hsl(var(--muted-foreground))",
        }}>
          Oder{" "}
          <button
            onClick={handleKiPrefill}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "hsl(var(--primary))",
              fontSize: "inherit",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            mit KI vorausfüllen
          </button>
          {" "}— Zielgruppen &amp; Wettbewerber werden automatisch ermittelt.
        </p>
      </div>

      {/* Section 3 — Divider */}
      <div style={{ height: 1, background: "hsl(var(--border))", marginBottom: "2rem" }} />

      {/* Section 4 — Feature tiles */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "0.875rem",
        marginBottom: "2rem",
      }}>
        {/* Tile 1 */}
        <div style={{
          border: "0.5px solid hsl(var(--border))",
          borderRadius: 12,
          padding: 20,
        }}>
          <div style={{
            width: 36, height: 36,
            borderRadius: 8,
            background: "hsl(217 91% 95%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 12,
          }}>
            <Bot size={18} color="hsl(217 91% 40%)" />
          </div>
          <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>
            LLM-Sichtbarkeit messen
          </div>
          <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", lineHeight: 1.55 }}>
            Wir simulieren, wie ChatGPT, Gemini und Claude Ihre Website wahrnehmen — und wo Informationen fehlen.
          </div>
        </div>

        {/* Tile 2 */}
        <div style={{
          border: "0.5px solid hsl(var(--border))",
          borderRadius: 12,
          padding: 20,
        }}>
          <div style={{
            width: 36, height: 36,
            borderRadius: 8,
            background: "hsl(43 96% 94%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 12,
          }}>
            <Radar size={18} color="hsl(43 96% 25%)" />
          </div>
          <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>
            Wettbewerb vergleichen
          </div>
          <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", lineHeight: 1.55 }}>
            Sehen Sie sofort, ob Konkurrenten in denselben KI-Antworten auftauchen — und warum.
          </div>
        </div>

        {/* Tile 3 */}
        <div style={{
          border: "0.5px solid hsl(var(--border))",
          borderRadius: 12,
          padding: 20,
        }}>
          <div style={{
            width: 36, height: 36,
            borderRadius: 8,
            background: "hsl(142 71% 94%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 12,
          }}>
            <ListChecks size={18} color="hsl(142 71% 25%)" />
          </div>
          <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>
            Priorisierte Maßnahmen
          </div>
          <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", lineHeight: 1.55 }}>
            Kritisch, hoher Hebel, nachgeordnet — klare Empfehlungen direkt aus der Analyse.
          </div>
        </div>
      </div>

      {/* Section 5 — Score preview panel */}
      <div style={{
        background: "#1e2235",
        borderRadius: 12,
        padding: "20px 24px",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: "24px",
        alignItems: "center",
      }}>
        {/* Col 1: Big score */}
        <div style={{ textAlign: "center", minWidth: 80 }}>
          <div style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.4)", marginBottom: 4, letterSpacing: "0.05em" }}>
            Beispiel-Ergebnis
          </div>
          <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1, color: "#f59e0b" }}>
            43
          </div>
          <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4, fontWeight: 500 }}>
            Ausbaufähig
          </div>
        </div>

        {/* Col 2: Mini bar chart */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DEMO_BARS.map(bar => (
            <div key={bar.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", width: 80, flexShrink: 0 }}>
                {bar.label}
              </div>
              <div style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: "rgba(255,255,255,0.1)",
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${bar.value}%`,
                  height: "100%",
                  background: bar.color,
                  borderRadius: 3,
                }} />
              </div>
              <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", width: 24, textAlign: "right", flexShrink: 0 }}>
                {bar.value}
              </div>
            </div>
          ))}
        </div>

        {/* Col 3: Explanatory text */}
        <div style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.6)",
          lineHeight: 1.6,
          maxWidth: 180,
        }}>
          So sieht ein typisches Ergebnis aus. Technische Grundlagen stimmen oft — aber für KI-Systeme fehlen verwertbare Inhalte, strukturierte Daten und FAQ-Strukturen.
        </div>
      </div>

    </div>
  );
}
