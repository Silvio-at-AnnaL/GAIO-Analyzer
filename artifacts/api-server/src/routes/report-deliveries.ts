import type { Router, Request, RequestHandler } from "express";
import type { ReportDeliveryItem } from "@workspace/api-zod";
import { query } from "../lib/db.js";
import { logger } from "../lib/logger.js";

interface DeliveryRow {
  id: number;
  created_at: string | null;
  recipient_email: string;
  company_name: string | null;
  domain: string | null;
  gaio_score: number | null;
  report_type: ReportDeliveryItem["reportType"];
  consent_marketing: boolean;
  consent_at: string | null;
  consent_text: string | null;
  status: ReportDeliveryItem["status"];
  error_message: string | null;
  analysis_log_id: number | null;
  has_report: boolean;
}

const FILTER = `
  WHERE ($1::text IS NULL OR rd.recipient_email ILIKE $1
    OR rd.company_name ILIKE $1 OR rd.domain ILIKE $1)
    AND (NOT $2::boolean OR rd.consent_marketing = TRUE)
`;
const SELECT = `
  SELECT rd.id, rd.recipient_email, rd.company_name, rd.domain, rd.gaio_score,
    rd.report_type, rd.consent_marketing, rd.consent_text, rd.status,
    rd.error_message, rd.analysis_log_id,
    TO_CHAR(rd.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
    TO_CHAR(rd.consent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS consent_at,
    (rd.analysis_log_id IS NOT NULL AND al.html_export_id IS NOT NULL) AS has_report
  FROM report_deliveries rd LEFT JOIN analysis_log al ON al.id = rd.analysis_log_id
`;

function filterParams(req: Request): [string | null, boolean] {
  return [typeof req.query.q === "string" && req.query.q ? `%${req.query.q}%` : null,
    req.query.consent === "only"];
}

const STATUS_TEXT = {
  sent: "zugestellt", failed: "fehlgeschlagen", not_configured: "kein Mailserver konfiguriert",
};
const berlinDate = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function formatDate(value: string | Date | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(berlinDate.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}
function csvField(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function deliveryItem(row: DeliveryRow): ReportDeliveryItem {
  return {
    id: row.id, createdAt: row.created_at, recipientEmail: row.recipient_email,
    companyName: row.company_name, domain: row.domain, gaioScore: row.gaio_score,
    reportType: row.report_type, consentMarketing: row.consent_marketing,
    consentAt: row.consent_at, consentText: row.consent_text, status: row.status,
    errorMessage: row.error_message, analysisLogId: row.analysis_log_id,
    hasReport: row.analysis_log_id !== null && row.has_report === true,
  };
}
function deliveryId(req: Request): number | null {
  const raw = String(req.params.id);
  const id = Number(raw);
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(id) ? id : null;
}

export function registerReportDeliveryRoutes(
  router: Router, requireAuth: RequestHandler, requireFeature: RequestHandler,
): void {
  router.get("/report-deliveries", requireAuth, requireFeature, async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
    const params = filterParams(req);
    try {
      const total = Number((await query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM report_deliveries rd ${FILTER}`, params,
      )).rows[0].c);
      const rows = (await query<DeliveryRow>(
        `${SELECT} ${FILTER} ORDER BY rd.created_at DESC, rd.id DESC LIMIT $3 OFFSET $4`,
        [...params, limit, (page - 1) * limit],
      )).rows;
      res.json({ items: rows.map(deliveryItem), total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      logger.warn({ err }, "Delivery log query failed");
      res.status(500).json({ error: "Versandprotokoll konnte nicht geladen werden" });
    }
  });

  // Register the literal CSV route before parameterized delivery routes.
  router.get("/report-deliveries/export.csv", requireAuth, requireFeature, async (req, res) => {
    try {
      const rows = (await query<DeliveryRow>(
        `${SELECT} ${FILTER} ORDER BY rd.created_at DESC, rd.id DESC LIMIT 10000`,
        filterParams(req),
      )).rows;
      const header = ["Datum/Uhrzeit", "E-Mail", "Unternehmen", "Domain", "GAIO-Score",
        "Report-Typ", "Einwilligung", "Einwilligung am", "Einwilligungstext", "Versandstatus"];
      const lines = [header.map(csvField).join(";"), ...rows.map(row => [
        formatDate(row.created_at), row.recipient_email, row.company_name, row.domain,
        row.gaio_score, row.report_type.toUpperCase(), row.consent_marketing ? "Ja" : "Nein",
        formatDate(row.consent_at), row.consent_text, STATUS_TEXT[row.status],
      ].map(csvField).join(";"))];
      const filenameDate = formatDate(new Date()).slice(0, 10).split(".").reverse().join("-");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="versandprotokoll_${filenameDate}.csv"`);
      res.send(`\uFEFF${lines.join("\r\n")}\r\n`);
    } catch (err) {
      logger.warn({ err }, "Delivery CSV export failed");
      res.status(500).json({ error: "Versandprotokoll konnte nicht exportiert werden" });
    }
  });

  router.get("/report-deliveries/:id/report", requireAuth, requireFeature, async (req, res) => {
    const id = deliveryId(req);
    if (id === null) { res.status(400).json({ error: "Ungültige ID" }); return; }
    try {
      const row = (await query<{ html_content: string; domain: string; started_at: string }>(`
        SELECT ae.html_content, al.domain,
          TO_CHAR(al.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
        FROM report_deliveries rd
        JOIN analysis_log al ON al.id = rd.analysis_log_id
        JOIN analysis_exports ae ON ae.id = al.html_export_id AND ae.analysis_id = al.id
        WHERE rd.id = $1
      `, [id])).rows[0];
      if (!row) { res.status(404).json({ error: "Kein HTML-Export vorhanden" }); return; }
      const date = String(row.started_at).slice(0, 10).replace(/-/g, "");
      const safeDomain = row.domain.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 50);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="GAIO-${safeDomain}-${date}.html"`);
      res.send(row.html_content);
    } catch (err) {
      logger.warn({ err }, "Delivery report download failed");
      res.status(500).json({ error: "HTML-Export konnte nicht geladen werden" });
    }
  });

  router.delete("/report-deliveries/:id", requireAuth, requireFeature, async (req, res) => {
    const id = deliveryId(req);
    if (id === null) { res.status(400).json({ error: "Ungültige ID" }); return; }
    try {
      const result = await query<{ id: number }>("DELETE FROM report_deliveries WHERE id = $1 RETURNING id", [id]);
      if (result.rows.length === 0) { res.status(404).json({ error: "Eintrag nicht gefunden" }); return; }
      res.json({ ok: true });
    } catch (err) {
      logger.warn({ err }, "Delivery deletion failed");
      res.status(500).json({ error: "Fehler beim Löschen" });
    }
  });
}
