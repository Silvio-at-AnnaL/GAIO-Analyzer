// Imported by admin.test.mjs so these checks exercise the real feature middleware
// and registered routes using the same isolated database/auth fixtures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

export function deliveryRouteTests({ reset, request }) {
  const paths = [
    ["GET", "/report-deliveries"],
    ["GET", "/report-deliveries/export.csv"],
    ["GET", "/report-deliveries/:id/report"],
    ["DELETE", "/report-deliveries/:id"],
  ];
  const row = (overrides = {}) => ({
    id: 1, created_at: "2026-10-14T06:30:00Z", recipient_email: "lead@example.test",
    company_name: "Acme", domain: "https://acme.test", gaio_score: 71,
    report_type: "html", consent_marketing: true, consent_at: "2026-10-14T06:30:00Z",
    consent_text: 'Text; "quoted"\nsecond line', status: "sent", error_message: null,
    analysis_log_id: 42, has_report: true, ...overrides,
  });
  function deliveryDatabase(rows = [], permissions) {
    const state = reset(permissions === undefined ? {} : { permissions_json: permissions });
    state.deliveryRows = rows;
    state.deliveryQuery = async (sql, params) => {
      if (sql.startsWith("DELETE FROM report_deliveries")) {
        const index = state.deliveryRows.findIndex(item => item.id === params[0]);
        return { rows: index < 0 ? [] : state.deliveryRows.splice(index, 1).map(item => ({ id: item.id })) };
      }
      if (sql.includes("SELECT ae.html_content")) return { rows: state.reportRows ?? [] };
      assert.match(sql, /rd\.recipient_email ILIKE \$1/);
      assert.match(sql, /rd\.company_name ILIKE \$1/);
      assert.match(sql, /rd\.domain ILIKE \$1/);
      assert.match(sql, /NOT \$2::boolean OR rd\.consent_marketing = TRUE/);
      const needle = params[0]?.slice(1, -1).toLowerCase();
      const matching = state.deliveryRows.filter(item =>
        (!needle || [item.recipient_email, item.company_name, item.domain]
          .some(value => value?.toLowerCase().includes(needle))) &&
        (!params[1] || item.consent_marketing));
      if (sql.includes("COUNT(*)")) return { rows: [{ c: matching.length }] };
      assert.match(sql, /ORDER BY rd\.created_at DESC, rd\.id DESC/);
      return { rows: sql.includes("LIMIT 10000") ? matching.slice(0, 10000)
        : matching.slice(params[3], params[3] + params[2]) };
    };
    return state;
  }

  test("all delivery routes reject unauthenticated callers and unlisted roles", async () => {
    for (const [method, path] of paths) {
      for (const token of [null, "valid-user", "valid-extended"]) {
        const state = deliveryDatabase([row()]);
        const result = await request(method, path, { token, params: { id: "1" } });
        assert.equal(result.statusCode, token === null ? 401 : 403);
        if (token) assert.deepEqual(result.body, { error: "Keine Berechtigung" });
        assert.deepEqual(state.queries, []);
      }
    }
  });

  test("admins bypass feature settings; delegated user_extended is allowed only when listed", async () => {
    for (const [method, path] of paths) {
      for (const [token, permissions] of [
        ["valid-admin", "malformed"],
        ["valid-extended", JSON.stringify({ versandprotokoll: ["admin", "user_extended"] })],
        ["valid-user", JSON.stringify({ versandprotokoll: ["user"] })],
      ]) {
        const state = deliveryDatabase([row()], permissions);
        state.reportRows = [{ html_content: "<html>report</html>", domain: "https://acme.test", started_at: "2026-10-14T00:00:00Z" }];
        const result = await request(method, path, { token, params: { id: "1" } });
        assert.equal(result.statusCode, 200, `${token} ${method} ${path}`);
      }
    }
  });

  test("feature middleware denies missing, malformed and non-array grants without querying delivery data", async () => {
    for (const permissions of [
      undefined, "{", "null", "[]", JSON.stringify({ versandprotokoll: "user_extended" }),
      JSON.stringify({ analyseprotokoll: ["user_extended"] }),
    ]) {
      const state = deliveryDatabase([], permissions);
      assert.equal((await request("GET", "/report-deliveries", { token: "valid-extended" })).statusCode, 403);
      assert.deepEqual(state.queries, []);
    }
  });

  test("delivery permission alone does not grant analysis-log access", async () => {
    const state = deliveryDatabase([], JSON.stringify({ versandprotokoll: ["user_extended"] }));
    assert.equal((await request("GET", "/analysis-log", { token: "valid-extended" })).statusCode, 403);
    assert.equal((await request("DELETE", "/analysis-log/:id", { token: "valid-extended", params: { id: "42" } })).statusCode, 403);
    assert.deepEqual(state.queries, []);
  });

  test("delivery list applies parameterized case-insensitive q and consent filters with pagination", async () => {
    const state = deliveryDatabase([
      row(), row({ id: 2, recipient_email: "other@example.test", consent_marketing: false }),
      row({ id: 3, company_name: null, domain: "https://ACME.test", recipient_email: "third@example.test", analysis_log_id: null }),
    ]);
    const result = await request("GET", "/report-deliveries", { query: { q: "aCmE", consent: "only", page: "2", limit: "1" } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.total, 2);
    assert.equal(result.body.page, 2);
    assert.equal(result.body.pages, 2);
    assert.equal(result.body.items[0].id, 3);
    assert.equal(result.body.items[0].hasReport, false);
    assert.equal(result.body.items[0].analysisLogId, null);
    assert.deepEqual(state.queries.map(([, params]) => params), [["%aCmE%", true], ["%aCmE%", true, 1, 1]]);
    assert.match(state.queries[1][0], /LEFT JOIN analysis_log al ON al\.id = rd\.analysis_log_id/);
    assert.match(state.queries[1][0], /rd\.analysis_log_id IS NOT NULL AND al\.html_export_id IS NOT NULL/);
    assert.deepEqual(Object.keys(result.body.items[0]).sort(), [
      "id", "createdAt", "recipientEmail", "companyName", "domain", "gaioScore", "reportType",
      "consentMarketing", "consentAt", "consentText", "status", "errorMessage", "analysisLogId", "hasReport",
    ].sort());
  });

  test("delivery pagination defaults, invalid values, limit bounds and hasReport mapping match the analysis log", async () => {
    for (const [query, page, limit, offset] of [
      [{}, 1, 25, 0], [{ page: "-1", limit: "-4" }, 1, 1, 0],
      [{ page: "invalid", limit: "invalid" }, 1, 25, 0],
      [{ page: "3", limit: "101" }, 3, 100, 200],
    ]) {
      const state = deliveryDatabase([row(), row({ id: 2, has_report: false })]);
      const result = await request("GET", "/report-deliveries", { query });
      assert.equal(result.statusCode, 200);
      assert.equal(result.body.page, page);
      assert.deepEqual(state.queries[1][1], [null, false, limit, offset]);
      if (query.page === undefined) assert.deepEqual(result.body.items.map(item => item.hasReport), [true, false]);
    }
  });

  test("q is never interpolated into list or CSV SQL", async () => {
    for (const path of ["/report-deliveries", "/report-deliveries/export.csv"]) {
      const state = deliveryDatabase([]);
      const q = "'; DROP TABLE report_deliveries; --";
      assert.equal((await request("GET", path, { query: { q } })).statusCode, 200);
      for (const [sql, params] of state.queries) {
        assert.ok(!sql.includes(q));
        assert.equal(params[0], `%${q}%`);
      }
    }
  });

  test("CSV has BOM, German quoted header, semicolons, CRLF, escaped quotes, Berlin dates and German values", async () => {
    deliveryDatabase([
      row(), row({ id: 2, status: "failed", consent_marketing: false, consent_at: null }),
      row({ id: 3, status: "not_configured", report_type: "pdf", created_at: "2026-01-02T23:05:00Z" }),
    ]);
    const result = await request("GET", "/report-deliveries/export.csv");
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.charCodeAt(0), 0xFEFF);
    assert.ok(result.body.startsWith('\uFEFF"Datum/Uhrzeit";"E-Mail";"Unternehmen";"Domain";"GAIO-Score";"Report-Typ";"Einwilligung";"Einwilligung am";"Einwilligungstext";"Versandstatus"\r\n'));
    assert.ok(result.body.endsWith("\r\n"));
    for (const value of ['"14.10.2026 08:30"', '"03.01.2026 00:05"', '"Text; ""quoted""\nsecond line"',
      '"HTML";"Ja"', '"PDF";"Ja"', '"HTML";"Nein";""',
      '"zugestellt"', '"fehlgeschlagen"', '"kein Mailserver konfiguriert"']) {
      assert.ok(result.body.includes(value), value);
    }
    assert.equal(result.headers["Content-Type"], "text/csv; charset=utf-8");
    assert.match(result.headers["Content-Disposition"], /^attachment; filename="versandprotokoll_\d{4}-\d{2}-\d{2}\.csv"$/);
  });

  test("CSV prefixes all six dangerous leading characters and guards injected formulas", async () => {
    for (const value of ['=HYPERLINK("https://evil.test")', "+SUM(1)", "-1+2", "@SUM(1)", "\t=1", "\r=1"]) {
      deliveryDatabase([row({ recipient_email: value, company_name: value, domain: value, consent_text: value })]);
      const result = await request("GET", "/report-deliveries/export.csv");
      const field = `"'${value.replace(/"/g, '""')}"`;
      assert.equal(result.body.split(field).length - 1, 4, value);
    }
  });

  test("CSV applies the same filters and limits the export to 10000 rows", async () => {
    const state = deliveryDatabase([
      row(), row({ id: 2, consent_marketing: false }), row({ id: 3, company_name: "Other", domain: null }),
    ]);
    const result = await request("GET", "/report-deliveries/export.csv", { query: { q: "acme", consent: "only" } });
    assert.equal(result.body.split("\r\n").length, 3);
    assert.deepEqual(state.queries[0][1], ["%acme%", true]);
    assert.match(state.queries[0][0], /LIMIT 10000/);
    deliveryDatabase(Array.from({ length: 10001 }, (_, i) => row({ id: i + 1, consent_text: "" })));
    const capped = await request("GET", "/report-deliveries/export.csv");
    assert.equal(capped.body.split("\r\n").length, 10002);
  });

  test("delivery report returns 404 for an unlinked, missing or unavailable export", async () => {
    for (const data of [[], [row({ analysis_log_id: null, has_report: false })], [row({ has_report: false })]]) {
      const state = deliveryDatabase(data);
      const result = await request("GET", "/report-deliveries/:id/report", { params: { id: "1" } });
      assert.equal(result.statusCode, 404);
      assert.match(state.queries[0][0], /JOIN analysis_log al ON al\.id = rd\.analysis_log_id/);
      assert.match(state.queries[0][0], /JOIN analysis_exports ae ON ae\.id = al\.html_export_id AND ae\.analysis_id = al\.id/);
      assert.deepEqual(state.queries[0][1], [1]);
    }
  });

  test("delivery report returns linked HTML with the existing safe download headers", async () => {
    const state = deliveryDatabase([row()]);
    state.reportRows = [{ html_content: "<html>persisted</html>", domain: 'https://test.example/"x"', started_at: "2026-10-14T06:30:00Z" }];
    const result = await request("GET", "/report-deliveries/:id/report", { params: { id: "1" } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, "<html>persisted</html>");
    assert.equal(result.headers["Content-Type"], "text/html; charset=utf-8");
    assert.equal(result.headers["Content-Disposition"], 'attachment; filename="GAIO-https___test.example__x_-20261014.html"');
  });

  test("delivery delete removes only that row and returns 404 for missing rows", async () => {
    const state = deliveryDatabase([row(), row({ id: 2 })]);
    const result = await request("DELETE", "/report-deliveries/:id", { params: { id: "1" } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { ok: true });
    assert.deepEqual(state.deliveryRows.map(item => item.id), [2]);
    assert.deepEqual(state.queries, [["DELETE FROM report_deliveries WHERE id = $1 RETURNING id", [1]]]);
    assert.equal((await request("DELETE", "/report-deliveries/:id", { params: { id: "1" } })).statusCode, 404);
  });

  test("delivery mutation/download IDs are strictly validated", async () => {
    for (const [method, path] of paths.slice(2)) {
      for (const id of ["0", "-1", "1oops", "1.5", "Infinity", "9007199254740992"]) {
        const state = deliveryDatabase([row()]);
        assert.equal((await request(method, path, { params: { id } })).statusCode, 400);
        assert.deepEqual(state.queries, []);
      }
    }
  });

  test("all delivery database failures return explicit 500 errors", async () => {
    for (const [method, path] of paths) {
      const state = deliveryDatabase([row()]);
      state.deliveryQuery = async () => { throw new Error("Database unavailable"); };
      assert.equal((await request(method, path, { params: { id: "1" } })).statusCode, 500);
    }
  });

  test("schema init auto-registers the new feature with admin-only default permissions", async () => {
    const source = await readFile(new URL("../lib/admin-db.ts", import.meta.url), "utf8");
    assert.match(source, /const ALL_FEATURE_IDS = \[[\s\S]*?"versandprotokoll"[\s\S]*?\];/);
    assert.match(source, /if \(!\(id in current\)\) \{ current\[id\] = \["admin"\]; changed = true; \}/);
  });
}
