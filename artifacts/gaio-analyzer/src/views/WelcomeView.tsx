import { useState } from "react";
import { Bot, Radar, ListChecks } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { normalizeUrl } from "@/lib/utils";
import { useT } from "@/lib/LabelProvider";

interface WelcomeViewProps {
  onDismiss: () => void;
}

export function WelcomeView({ onDismiss }: WelcomeViewProps) {
  const { domainForm, setDomainForm } = useAppStore();
  const [companyInput, setCompanyInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const t = useT();

  function applyAndDismiss() {
    setDomainForm({
      ...domainForm,
      ...(companyInput.trim() ? { companyName: companyInput.trim() } : {}),
      ...(urlInput.trim() ? { url: normalizeUrl(urlInput) } : {}),
    });
    onDismiss();
  }

  function handleStart() {
    applyAndDismiss();
  }

  function handleKiPrefill() {
    applyAndDismiss();
  }

  const DEMO_BARS = [
    { labelKey: "welcome.demo_seo",     value: 86, color: "#ef4444" },
    { labelKey: "welcome.demo_schema",  value: 8,  color: "#a855f7" },
    { labelKey: "welcome.demo_content", value: 33, color: "#22c55e" },
    { labelKey: "welcome.demo_llm",     value: 27, color: "#06b6d4" },
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
            {t("welcome.eyebrow")}
          </span>
        </div>

        <h1 style={{
          fontSize: "clamp(1.6rem, 3.5vw, 2.2rem)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
          margin: 0,
        }}>
          {t("welcome.headline_pre")}{" "}
          <span style={{ color: "hsl(var(--primary))" }}>ChatGPT</span>
          {" "}{t("welcome.headline_post")}
        </h1>

        <p style={{
          fontSize: "0.95rem",
          color: "hsl(var(--muted-foreground))",
          lineHeight: 1.6,
          maxWidth: 520,
          margin: 0,
        }}>
          {t("welcome.subline")}
        </p>
      </div>

      {/* Section 2 — Company + URL quick-entry */}
      <div className="mb-10">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>

          {/* Row 1 — Company name */}
          <div>
            <label style={{
              display: "block",
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "hsl(var(--muted-foreground))",
              marginBottom: 5,
            }}>
              {t("welcome.label_company")}
            </label>
            <input
              type="text"
              value={companyInput}
              onChange={e => setCompanyInput(e.target.value)}
              placeholder={t("welcome.placeholder_company")}
              style={{
                width: "100%",
                height: 42,
                padding: "0 0.875rem",
                borderRadius: "0.5rem",
                border: "1.5px solid hsl(var(--border))",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                fontSize: "0.875rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Row 2 — URL + button */}
          <div style={{ display: "flex" }}>
            <input
              type="url"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onBlur={e => setUrlInput(normalizeUrl(e.target.value))}
              onKeyDown={e => e.key === "Enter" && handleStart()}
              placeholder={t("welcome.placeholder_url")}
              style={{
                flex: 1,
                height: 42,
                padding: "0 0.875rem",
                borderRadius: "0.5rem 0 0 0.5rem",
                border: "1.5px solid hsl(var(--border))",
                borderRight: "none",
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
                borderRadius: "0 0.5rem 0.5rem 0",
                background: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
                fontWeight: 600,
                fontSize: "0.875rem",
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {t("welcome.btn_start")}
            </button>
          </div>
        </div>

        <p style={{
          marginTop: "0.6rem",
          fontSize: "0.775rem",
          color: "hsl(var(--muted-foreground))",
        }}>
          {t("welcome.prefill_prefix")}{" "}
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
            {t("welcome.prefill_link")}
          </button>
          {" "}{t("welcome.prefill_suffix")}
        </p>
      </div>

      {/* Section 3 — Divider */}
      <div style={{ height: 1, background: "hsl(var(--border))", marginBottom: "2rem" }} />

      {/* Section 4 — Feature tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-9">
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
            {t("welcome.tile1_title")}
          </div>
          <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", lineHeight: 1.55 }}>
            {t("welcome.tile1_desc")}
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
            {t("welcome.tile2_title")}
          </div>
          <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", lineHeight: 1.55 }}>
            {t("welcome.tile2_desc")}
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
            {t("welcome.tile3_title")}
          </div>
          <div style={{ fontSize: "0.75rem", color: "hsl(var(--muted-foreground))", lineHeight: 1.55 }}>
            {t("welcome.tile3_desc")}
          </div>
        </div>
      </div>

      {/* Section 5 — Score preview panel */}
      <div style={{ background: "#1e2235", borderRadius: 12, padding: "20px 24px" }}>
        <div className="flex flex-col md:flex-row items-start gap-6">

          {/* Score number */}
          <div className="shrink-0" style={{ textAlign: "center", minWidth: 80 }}>
            <div style={{ fontSize: "0.65rem", color: "rgba(255,255,255,0.4)", marginBottom: 4, letterSpacing: "0.05em" }}>
              {t("welcome.preview_label")}
            </div>
            <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1, color: "#f59e0b" }}>
              43
            </div>
            <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4, fontWeight: 500 }}>
              {t("welcome.preview_grade")}
            </div>
          </div>

          {/* Vertical divider — desktop only */}
          <div className="hidden md:block w-px self-stretch" style={{ background: "rgba(255,255,255,0.1)" }} />

          {/* Bar chart */}
          <div className="flex-1 w-full space-y-2">
            {DEMO_BARS.map(bar => (
              <div key={bar.labelKey} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", width: 80, flexShrink: 0 }}>
                  {t(bar.labelKey)}
                </div>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div style={{ width: `${bar.value}%`, height: "100%", background: bar.color, borderRadius: 9999 }} />
                </div>
                <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", width: 24, textAlign: "right", flexShrink: 0 }}>
                  {bar.value}
                </div>
              </div>
            ))}
          </div>

          {/* Horizontal divider — mobile only */}
          <div className="block md:hidden w-full h-px" style={{ background: "rgba(255,255,255,0.1)" }} />

          {/* Description text */}
          <div className="flex-1" style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
            {t("welcome.preview_desc")}
          </div>

        </div>
      </div>

    </div>
  );
}
