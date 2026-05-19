import { useState, useEffect, useRef } from "react";
import { ContactRound, UploadCloud, Trash2, Save, CheckCircle, AlertCircle, Mail } from "lucide-react";
import { adminFetch } from "@/store/authStore";

interface ContactSettings {
  contact_name: string;
  contact_title: string;
  contact_company: string;
  contact_email: string;
  contact_photo_base64: string;
  contact_cta_text: string;
  contact_cta_subtext: string;
}

const MAX_B64_BYTES = 500 * 1024;

function sizeOk(dataUrl: string): boolean {
  const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return Math.round((b64.length * 3) / 4) <= MAX_B64_BYTES;
}

function ContactPreview({
  name, title, company, email, photoSrc, ctaText, ctaSubtext,
}: {
  name: string; title: string; company: string; email: string;
  photoSrc: string; ctaText: string; ctaSubtext: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5 text-sm">
      {/* Avatar */}
      <div className="flex flex-col items-center gap-3">
        {photoSrc ? (
          <img
            src={photoSrc}
            alt={name}
            className="w-20 h-20 rounded-full object-cover object-top border-2 border-border"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-muted border border-border flex items-center justify-center">
            <ContactRound className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        <div className="text-center">
          <p className="font-bold text-base">{name || "Name"}</p>
          <p className="text-muted-foreground text-xs mt-0.5">{title || "Funktion"}</p>
          <p className="text-muted-foreground text-xs">{company || "Unternehmen"}</p>
        </div>
        {email && (
          <a
            href={`mailto:${email}`}
            className="flex items-center gap-1.5 font-medium"
            style={{ color: "#3b82f6", fontSize: 12 }}
          >
            <Mail className="w-3 h-3" />
            {email}
          </a>
        )}
      </div>

      {/* CTA text */}
      {(ctaText || ctaSubtext) && (
        <div className="border-t border-border pt-4 space-y-2">
          {ctaText && <p className="text-foreground/90 leading-relaxed" style={{ fontSize: 12 }}>{ctaText}</p>}
          {ctaSubtext && <p className="text-muted-foreground" style={{ fontSize: 11 }}>{ctaSubtext}</p>}
        </div>
      )}

      {/* Button */}
      {email && (
        <a
          href={`mailto:${email}`}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-white text-xs font-semibold w-fit"
          style={{ background: "#3b82f6" }}
        >
          <Mail className="w-3 h-3" />
          E-Mail schreiben
        </a>
      )}
    </div>
  );
}

export function ContactEditorView() {
  const [name, setName]           = useState("Silvio Haase");
  const [title, setTitle]         = useState("CMO & Head of Business Development");
  const [company, setCompany]     = useState("Deutscher Medien Verlag GmbH / IndustryStock.com");
  const [email, setEmail]         = useState("Silvio.Haase@IndustryStock.com");
  const [photoSrc, setPhotoSrc]   = useState("");
  const [ctaText, setCtaText]     = useState("");
  const [ctaSubtext, setCtaSubtext] = useState("");

  const [status, setStatus]       = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [msg, setMsg]             = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    adminFetch("/api/admin/settings/contact")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ContactSettings | null) => {
        if (!d) return;
        setName(d.contact_name ?? "");
        setTitle(d.contact_title ?? "");
        setCompany(d.contact_company ?? "");
        setEmail(d.contact_email ?? "");
        setPhotoSrc(d.contact_photo_base64 ?? "");
        setCtaText(d.contact_cta_text ?? "");
        setCtaSubtext(d.contact_cta_subtext ?? "");
      })
      .catch(() => {});
  }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!sizeOk(dataUrl)) {
        setStatus("error");
        setMsg("Datei zu groß. Maximal 500 KB erlaubt.");
        return;
      }
      setPhotoSrc(dataUrl);
      setStatus("idle");
      setMsg("");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function save() {
    setStatus("saving");
    setMsg("");
    try {
      const res = await adminFetch("/api/admin/settings/contact", {
        method: "PATCH",
        body: JSON.stringify({
          contact_name:         name,
          contact_title:        title,
          contact_company:      company,
          contact_email:        email,
          contact_photo_base64: photoSrc,
          contact_cta_text:     ctaText,
          contact_cta_subtext:  ctaSubtext,
        }),
      });
      if (res.ok) {
        setStatus("ok");
        setMsg("Kontaktdaten gespeichert.");
      } else {
        const d = (await res.json()) as { error?: string };
        setStatus("error");
        setMsg(d.error ?? "Fehler beim Speichern.");
      }
    } catch {
      setStatus("error");
      setMsg("Netzwerkfehler.");
    }
  }

  return (
    <div className="max-w-5xl space-y-6 pb-12">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ContactRound className="w-5 h-5" style={{ color: "#3b82f6" }} />
          <h1 className="text-2xl font-bold tracking-tight">Kontakt-Daten</h1>
        </div>
        <p className="text-muted-foreground text-sm">Kontaktperson und CTA-Text für die Kontaktseite bearbeiten.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: form */}
        <div className="flex-1 space-y-4">
          <div className="rounded-xl border border-border bg-card p-6 space-y-5">

            {/* Kontaktperson */}
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Kontaktperson</h2>
              <div className="space-y-3">
                {[
                  { label: "Name",                value: name,    setter: setName,    type: "text" },
                  { label: "Funktion / Titel",    value: title,   setter: setTitle,   type: "text" },
                  { label: "Unternehmen",         value: company, setter: setCompany, type: "text" },
                  { label: "E-Mail",              value: email,   setter: setEmail,   type: "email" },
                ].map(({ label, value, setter, type }) => (
                  <div key={label}>
                    <label className="block text-sm font-medium mb-1">{label}</label>
                    <input
                      type={type}
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Profilbild */}
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Profilbild</h2>
              <div className="flex items-center gap-4 mb-3">
                {photoSrc ? (
                  <img
                    src={photoSrc}
                    alt="Profilbild"
                    className="w-16 h-16 rounded-full object-cover object-top border-2 border-border"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-muted border border-border flex items-center justify-center">
                    <ContactRound className="w-7 h-7 text-muted-foreground" />
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={onFileChange}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-muted transition-colors"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    Foto hochladen
                  </button>
                  {photoSrc && (
                    <button
                      onClick={() => setPhotoSrc("")}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-muted transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Foto entfernen
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Kontakttext */}
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Kontakttext</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">CTA-Text</label>
                  <p className="text-xs text-muted-foreground mb-1">Haupttext über dem Button</p>
                  <textarea
                    rows={3}
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">CTA-Subtext</label>
                  <p className="text-xs text-muted-foreground mb-1">Kleinerer Text unter dem Haupttext</p>
                  <textarea
                    rows={2}
                    value={ctaSubtext}
                    onChange={(e) => setCtaSubtext(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Save */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={save}
                disabled={status === "saving"}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "#3b82f6" }}
              >
                <Save className="w-4 h-4" />
                {status === "saving" ? "Speichern…" : "Speichern"}
              </button>
              {msg && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: status === "ok" ? "#3b82f6" : "#d97706" }}>
                  {status === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {msg}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: live preview */}
        <div className="lg:w-72 shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Vorschau</p>
          <ContactPreview
            name={name}
            title={title}
            company={company}
            email={email}
            photoSrc={photoSrc}
            ctaText={ctaText}
            ctaSubtext={ctaSubtext}
          />
        </div>
      </div>
    </div>
  );
}
