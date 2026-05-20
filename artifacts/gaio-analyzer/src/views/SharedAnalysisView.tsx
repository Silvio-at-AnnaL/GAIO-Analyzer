import { useEffect, useState } from "react";
import { useParams } from "wouter";

interface ShareData {
  domain: string;
  title: string | null;
  companyName: string | null;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  htmlContent: string;
  contactCompany: string | null;
}

type State = "loading" | "ok" | "expired" | "not-found" | "disabled" | "error";

export function SharedAnalysisView() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<ShareData | null>(null);

  const basePrefix = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  useEffect(() => {
    if (!token) { setState("not-found"); return; }
    fetch(`${basePrefix}/api/shares/${token}`)
      .then(async (res) => {
        if (res.status === 404) { setState("not-found"); return; }
        if (res.status === 410) { setState("expired"); return; }
        if (res.status === 403) { setState("disabled"); return; }
        if (!res.ok) { setState("error"); return; }
        const json = await res.json() as ShareData;
        setData(json);
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [token, basePrefix]);

  if (state === "loading") {
    return (
      <div style={pageStyle}>
        <TopBar title="Analyse wird geladen…" />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
          <div style={{ color: "#9ca3af", fontSize: 14 }}>Bitte warten…</div>
        </div>
      </div>
    );
  }

  if (state === "not-found") {
    return (
      <div style={pageStyle}>
        <TopBar title="Nicht gefunden" />
        <ErrorBox icon="🔍" title="Freigabe nicht gefunden" text="Dieser Link existiert nicht oder wurde noch nie erstellt." />
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div style={pageStyle}>
        <TopBar title="Freigabe abgelaufen" />
        <ErrorBox icon="⏰" title="Freigabe abgelaufen" text="Dieser Link ist nicht mehr gültig. Bitte wende dich an den Absender für einen neuen Link." />
      </div>
    );
  }

  if (state === "disabled") {
    return (
      <div style={pageStyle}>
        <TopBar title="Analyse-Sharing deaktiviert" />
        <ErrorBox icon="🔒" title="Sharing deaktiviert" text="Das Teilen von Analysen ist auf diesem System deaktiviert." />
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div style={pageStyle}>
        <TopBar title="Fehler" />
        <ErrorBox icon="⚠️" title="Fehler beim Laden" text="Der Analyse-Report konnte nicht geladen werden. Bitte versuche es später erneut." />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <TopBar title={data.title ?? `Analyse: ${data.domain}`} domain={data.domain} />
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <iframe
          srcDoc={data.htmlContent}
          sandbox="allow-same-origin allow-popups"
          style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
          title={`GAIO Analyse — ${data.domain}`}
        />
      </div>
      <Footer
        contactCompany={data.contactCompany}
        expiresAt={data.expiresAt}
      />
    </div>
  );
}

function TopBar({ title, domain }: { title: string; domain?: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 20px", borderBottom: "1px solid #1f2937",
      background: "#0a0f1e", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6", letterSpacing: 1, fontFamily: "monospace" }}>
          GAIO ANALYZER
        </span>
        <span style={{ color: "#374151", fontSize: 13 }}>|</span>
        <span style={{ fontSize: 13, color: "#d1d5db" }}>{title}</span>
      </div>
      <a
        href="/"
        style={{ fontSize: 11, color: "#6b7280", textDecoration: "none" }}
      >
        Powered by GAIO Analyzer
      </a>
    </div>
  );
}

function Footer({ contactCompany, expiresAt }: { contactCompany: string | null; expiresAt: string }) {
  return (
    <div style={{
      padding: "8px 20px", borderTop: "1px solid #1f2937",
      background: "#0a0f1e", flexShrink: 0, textAlign: "center",
      fontSize: 11, color: "#6b7280",
    }}>
      {contactCompany
        ? `Dieser Report wurde geteilt von ${contactCompany}. `
        : ""}
      Gültig bis {new Date(expiresAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}.
    </div>
  );
}

function ErrorBox({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
      <div style={{ textAlign: "center", maxWidth: 400, padding: 32 }}>
        <div style={{ fontSize: 48 }}>{icon}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#f9fafb", marginTop: 16 }}>{title}</div>
        <div style={{ fontSize: 14, color: "#9ca3af", marginTop: 8, lineHeight: 1.6 }}>{text}</div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: "#0a0f1e",
  color: "#f9fafb",
  fontFamily: "system-ui, sans-serif",
  overflow: "hidden",
};
