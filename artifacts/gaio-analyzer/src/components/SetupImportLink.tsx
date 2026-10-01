import { useRef, useState } from "react";
import { canAccess, useAuth } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { useT } from "@/lib/LabelProvider";
import {
  formatSetupExportDate, hasSetupContent, prepareSetupImport, setupToDomainForm,
} from "@/lib/setup-import";

const ERROR_LABELS = {
  read: "domain.import_setup_error_read",
  not_a_report: "domain.import_setup_error_not_report",
  no_setup_data: "domain.import_setup_error_no_setup",
  html_mode: "domain.import_setup_error_html_mode",
  failed_report: "domain.import_setup_error_failed",
  no_pages: "domain.import_setup_error_no_pages",
} as const;
const WARNING_LABELS: Record<string, string> = {
  requested_pages_not_analyzed: "domain.import_setup_warn_requested",
  page_count_mismatch: "domain.import_setup_warn_count",
  persona_not_found: "domain.import_setup_warn_persona",
  competitors_truncated: "domain.import_setup_warn_competitors",
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject();
    reader.onerror = reader.onabort = () => reject();
    reader.readAsText(file);
  });
}

export function SetupImportLink({
  onBeforeApply, onImported, hasAdditionalContent = false, className = "",
}: {
  onBeforeApply?: () => void;
  onImported?: () => void;
  hasAdditionalContent?: boolean;
  className?: string;
}) {
  const auth = useAuth();
  const store = useAppStore();
  const t = useT();
  const allowed = auth.isAuthenticated && !!auth.user
    && canAccess("setup_import", auth.user.role, auth.permissions);
  const latest = useRef({ store, allowed, hasAdditionalContent });
  latest.current = { store, allowed, hasAdditionalContent };
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (!latest.current.allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await prepareSetupImport(file, {
        readText: readFile,
        hasContent: () => latest.current.hasAdditionalContent || hasSetupContent(
          latest.current.store.domainForm,
          [latest.current.store.crawledPages, latest.current.store.selectedPages],
        ),
        confirm: () => window.confirm(t("domain.import_setup_confirm")),
      });
      if (!latest.current.allowed) return;
      if (!result.ok) {
        if ("reason" in result) setError(ERROR_LABELS[result.reason]);
        return;
      }
      const { setup, source, warnings } = result.parsed;
      const current = latest.current.store;
      onBeforeApply?.();
      current.setDomainForm(setupToDomainForm(setup));
      current.setCrawledPages([...setup.pages]);
      current.setSelectedPages([...setup.pages]);
      current.setSetupImportNotice({ source, warnings, exportDate: setup.exportDate, count: setup.pages.length });
      onImported?.();
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return null;
  const notice = store.setupImportNotice;
  return (
    <span className={`inline-block ${className}`}>
      <button
        type="button"
        className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors disabled:opacity-50"
        disabled={busy}
        onClick={() => picker.current?.click()}
        data-testid="button-setup-import"
      >
        {t("domain.import_setup_link")}
      </button>
      <input
        ref={picker}
        type="file"
        accept=".html,.htm"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="input-setup-import"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void handleFile(file);
        }}
      />
      {error && <span role="alert" className="block mt-2 text-xs text-destructive">{t(error)}</span>}
      {!error && notice && (
        <span role="status" className="block mt-2 space-y-1 text-xs text-muted-foreground">
          <span className="block">{t("domain.import_setup_success", {
            date: formatSetupExportDate(notice.exportDate),
            source: t(notice.source === "block-v2" ? "domain.import_setup_source_block" : "domain.import_setup_source_fallback"),
            count: notice.count,
          })}</span>
          {notice.warnings.map((warning) => WARNING_LABELS[warning] ? (
            <span className="block" key={warning}>{t(WARNING_LABELS[warning])}</span>
          ) : null)}
        </span>
      )}
    </span>
  );
}