import { Router } from "express";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { db, getSetting } from "../lib/admin-db.js";

const sharesRouter = Router();

interface SharedAnalysisRow {
  id: number;
  token: string;
  analysis_id: number | null;
  is_active: number;
  expires_at: string;
  title: string | null;
  view_count: number;
  created_at: string;
}

interface HtmlExportRow {
  html_content: string;
}

interface ContactRow {
  value: string;
}

// GET /api/shares/:token — public, no auth required
sharesRouter.get("/:token", (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token || typeof token !== "string") { res.status(400).json({ error: "Token fehlt" }); return; }

  const sharingEnabled = getSetting("sharing_enabled");
  if (sharingEnabled === "false") { res.status(403).json({ error: "Sharing ist deaktiviert" }); return; }

  const share = db.prepare(`
    SELECT sa.id, sa.token, sa.analysis_id, sa.is_active, sa.expires_at, sa.title, sa.view_count, sa.created_at
    FROM shared_analyses sa
    WHERE sa.token = ?
  `).get(token) as SharedAnalysisRow | undefined;

  if (!share) { res.status(404).json({ error: "Freigabe nicht gefunden" }); return; }
  if (!share.is_active) { res.status(410).json({ error: "Freigabe deaktiviert" }); return; }
  if (new Date(share.expires_at) < new Date()) { res.status(410).json({ error: "Freigabe abgelaufen" }); return; }

  // Get HTML content
  let htmlContent = "";
  let domain: string | null = null;
  let companyName: string | null = null;

  if (share.analysis_id) {
    const exportRow = db.prepare(`
      SELECT ae.html_content, al.domain, al.company_name
      FROM analysis_exports ae
      JOIN analysis_log al ON al.id = ae.analysis_id
      WHERE al.id = ?
    `).get(share.analysis_id) as (HtmlExportRow & { domain: string; company_name: string | null }) | undefined;

    if (exportRow) {
      htmlContent = exportRow.html_content;
      domain = exportRow.domain;
      companyName = exportRow.company_name;
    }
  }

  // Log access
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "");
  const ipHash = ip ? createHash("sha256").update(ip).digest("hex").slice(0, 16) : null;
  const userAgent = String(req.headers["user-agent"] ?? "").slice(0, 255) || null;

  db.prepare(`
    INSERT INTO share_access_log (share_id, ip_hash, user_agent) VALUES (?, ?, ?)
  `).run(share.id, ipHash, userAgent);

  db.prepare(`
    UPDATE shared_analyses SET view_count = view_count + 1 WHERE id = ?
  `).run(share.id);

  // Contact company for footer
  const contactCompanyRow = db.prepare("SELECT value FROM settings WHERE key = 'contact_company'").get() as ContactRow | undefined;
  const contactCompany = contactCompanyRow?.value ?? null;

  res.json({
    domain,
    title: share.title,
    companyName,
    createdAt: share.created_at,
    expiresAt: share.expires_at,
    viewCount: share.view_count + 1,
    htmlContent,
    contactCompany,
  });
});

export default sharesRouter;
