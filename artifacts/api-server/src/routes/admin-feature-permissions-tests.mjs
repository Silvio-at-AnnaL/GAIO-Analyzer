import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const ROUTE_FEATURES = {
  analyseprotokoll: ["GET /analysis-log", "GET /analysis-log/:id/export", "DELETE /analysis-log/:id", "POST /analysis/:id/send-email"],
  systemprotokoll: ["GET /system-events", "GET /system-events/export"],
  angebots_creator: ["POST /angebot/generate"],
  erscheinungsbild: ["GET /settings/theme", "GET /settings/branding", "PATCH /settings/branding"],
  kontakt_daten: ["GET /settings/contact", "PATCH /settings/contact"],
  ki_tool: ["GET /settings/ai-status", "POST /settings/ai-test"],
  mailserver: ["POST /settings/test-mail"],
  score_einstellungen: ["GET /score-profiles", "PATCH /score-profiles/:slug", "POST /score-profiles/:slug/reset"],
  prompt_verwaltung: ["GET /prompts", "GET /prompts/:slug", "PATCH /prompts/:slug", "POST /prompts/:slug/reset"],
  textverwaltung: ["GET /labels", "PATCH /labels/:key", "POST /labels/:key/reset"],
  geteilte_analysen: ["POST /shares", "GET /shares", "DELETE /shares/:id", "GET /shares/:id/access-log"],
};
const ADMIN_ONLY = [
  "GET /users", "POST /users", "PATCH /users/:id/role", "DELETE /users/:id",
  "PATCH /settings/permissions", "GET /settings/database", "POST /settings/database",
  "POST /settings/database/test",
];

export function adminFeaturePermissionTests({ reset, request }) {
  for (const [feature, routes] of Object.entries(ROUTE_FEATURES)) {
    test(`${feature}: every mapped route allows admins/delegates and denies missing grants/anonymous callers`, async () => {
      for (const route of routes) {
        const [method, path] = route.split(" ");
        for (const [token, permissions, expected] of [
          ["valid-admin", {}, 200],
          ["valid-extended", { [feature]: ["user_extended"] }, 200],
          ["valid-extended", {}, 403],
          [null, { [feature]: ["user_extended"] }, 401],
        ]) {
          const state = reset({ permissions_json: JSON.stringify(permissions) });
          const result = await request(method, path, { token, guardsOnly: true, params: { id: "42", slug: "default", key: "title" } });
          assert.equal(result.statusCode, expected, `${token} ${route}`);
          assert.deepEqual(state.queries, [], "Middleware must not run the actual route");
          assert.deepEqual(state.saved, []);
        }
      }
    });
  }

  test("representative feature handlers execute for admins and delegated user_extended", async () => {
    const representatives = [
      ["analyseprotokoll", "GET", "/analysis-log", {}, 200],
      ["systemprotokoll", "GET", "/system-events", {}, 200],
      ["angebots_creator", "POST", "/angebot/generate", { fromUpload: true }, 400],
      ["erscheinungsbild", "GET", "/settings/theme", {}, 200],
      ["kontakt_daten", "GET", "/settings/contact", {}, 200],
      ["ki_tool", "POST", "/settings/ai-test", {}, 200],
      ["mailserver", "POST", "/settings/test-mail", {}, 200],
      ["score_einstellungen", "GET", "/score-profiles", {}, 200],
      ["prompt_verwaltung", "GET", "/prompts", {}, 200],
      ["textverwaltung", "GET", "/labels", {}, 200],
      ["geteilte_analysen", "GET", "/shares", {}, 200],
    ];
    for (const [feature, method, path, body, status] of representatives) {
      for (const token of ["valid-admin", "valid-extended"]) {
        const state = reset({
          permissions_json: JSON.stringify({ [feature]: ["user_extended"] }),
          mail_from_address: "mail@example.test",
        });
        state.deliveryQuery = async sql => ({
          rows: sql.includes("COUNT(*)") ? [{ c: 0 }]
            : sql.includes("as total_kb") ? [{ total_kb: 0 }] : [],
        });
        const result = await request(method, path, { token, body });
        assert.equal(result.statusCode, status, `${token} ${path}`);
        // Angebot with incomplete upload data reaches its original 400 validation,
        // rather than being blocked by the guard. All other handlers return 200.
        if (feature === "angebots_creator") assert.deepEqual(result.body, { error: "Unvollständige Upload-Daten" });
      }
    }
  });

  test("GET/PATCH settings group permissions map ai/mail/delivery to their own features", async () => {
    for (const method of ["GET", "PATCH"]) {
      for (const [group, feature] of [["ai", "ki_tool"], ["mail", "mailserver"], ["delivery", "versand_analyse"]]) {
        for (const [token, permissions, expected] of [
          ["valid-admin", {}, 200],
          ["valid-extended", { [feature]: ["user_extended"] }, 200],
          ["valid-extended", {}, 403],
          [null, { [feature]: ["user_extended"] }, 401],
        ]) {
          reset({ permissions_json: JSON.stringify(permissions) });
          assert.equal((await request(method, "/settings/:group", { token, params: { group } })).statusCode, expected);
        }
      }
      const state = reset({ permissions_json: JSON.stringify({ ki_tool: ["user_extended"] }) });
      assert.equal((await request(method, "/settings/:group", { token: "valid-extended", params: { group: "mail" } })).statusCode, 403);
      assert.equal((await request(method, "/settings/:group", { token: "valid-extended", params: { group: "delivery" } })).statusCode, 403);
      assert.deepEqual(state.saved, []);
    }
  });

  test("unknown and prototype-named settings groups return 400 after authentication", async () => {
    for (const method of ["GET", "PATCH"]) {
      for (const group of ["unknown", "database", "constructor", "__proto__", "toString"]) {
        for (const token of ["valid-admin", "valid-extended"]) {
          reset();
          const result = await request(method, "/settings/:group", { token, params: { group } });
          assert.equal(result.statusCode, 400);
          assert.deepEqual(result.body, { error: "Ungültige Gruppe" });
        }
        reset();
        assert.equal((await request(method, "/settings/:group", { token: null, params: { group } })).statusCode, 401);
      }
    }
  });

  test("all four share routes deny basic users without the share feature", async () => {
    for (const route of ROUTE_FEATURES.geteilte_analysen) {
      const [method, path] = route.split(" ");
      const state = reset();
      const result = await request(method, path, { token: "valid-user", params: { id: "42" }, body: { analysisId: 42 } });
      assert.equal(result.statusCode, 403);
      assert.deepEqual(result.body, { error: "Keine Berechtigung" });
      assert.deepEqual(state.queries, []);
    }
  });

  test("all four share routes allow basic users with the explicit share feature", async () => {
    for (const route of ROUTE_FEATURES.geteilte_analysen) {
      const [method, path] = route.split(" ");
      const state = reset({ permissions_json: JSON.stringify({ geteilte_analysen: ["user"] }) });
      const result = await request(method, path, { token: "valid-user", params: { id: "42" }, body: { analysisId: 42 } });
      assert.equal(result.statusCode, 200);
      if (method === "POST") assert.match(state.queries[0][0], /INSERT INTO shared_analyses/);
      if (method === "DELETE") assert.match(state.queries[0][0], /UPDATE shared_analyses SET is_active = 0/);
    }
  });

  test("admin-only user/permission/database routes ignore all delegation attempts", async () => {
    const permissions = { nutzerverwaltung: ["user_extended", "user"], rechtemanagement: ["user_extended", "user"], mailserver: ["user_extended", "user"] };
    for (const route of ADMIN_ONLY) {
      const [method, path] = route.split(" ");
      for (const token of ["valid-extended", "valid-user", null]) {
        const state = reset({ permissions_json: JSON.stringify(permissions) });
        const result = await request(method, path, { token, params: { id: "42" } });
        assert.equal(result.statusCode, token === null ? 401 : 403, `${route} ${token}`);
        assert.deepEqual(state.queries, []);
        assert.deepEqual(state.saved, []);
      }
      reset({ permissions_json: "{}" });
      assert.equal((await request(method, path, { guardsOnly: true })).statusCode, 200);
    }
  });

  test("permission PATCH fixes the two nondelegable features without changing other grants or the request", async () => {
    for (const body of [
      { nutzerverwaltung: ["user_extended", "user"], rechtemanagement: ["user_extended"], mailserver: ["admin", "user_extended"] },
      { nutzerverwaltung: [], rechtemanagement: "user", geteilte_analysen: ["user"] },
      {},
    ]) {
      const snapshot = structuredClone(body);
      const state = reset();
      const result = await request("PATCH", "/settings/permissions", { body });
      assert.equal(result.statusCode, 200);
      assert.deepEqual(JSON.parse(state.settings.permissions_json), {
        ...body, nutzerverwaltung: ["admin"], rechtemanagement: ["admin"],
      });
      assert.deepEqual(body, snapshot);
      assert.deepEqual(result.body, { success: true });
    }
  });

  test("permission GET remains available to every signed-in role", async () => {
    for (const token of ["valid-admin", "valid-extended", "valid-user"]) {
      reset({ permissions_json: JSON.stringify({ mailserver: ["user_extended"] }) });
      assert.equal((await request("GET", "/settings/permissions", { token })).statusCode, 200);
    }
  });

  test("exact route headers retain auth first and each required feature/admin guard", async () => {
    const source = await readFile(new URL("./admin.ts", import.meta.url), "utf8");
    for (const [feature, routes] of Object.entries(ROUTE_FEATURES)) {
      for (const route of routes) {
        const [method, path] = route.split(" ");
        assert.ok(source.includes(`adminRouter.${method.toLowerCase()}("${path}", requireAuth, requireFeature("${feature}"),`), route);
      }
    }
    for (const route of ADMIN_ONLY) {
      const [method, path] = route.split(" ");
      assert.ok(source.includes(`adminRouter.${method.toLowerCase()}("${path}", requireAuth, requireAdmin,`), route);
    }
    for (const method of ["get", "patch"]) assert.ok(source.includes(`adminRouter.${method}("/settings/:group", requireAuth, requireSettingsFeature,`));
    assert.ok(source.includes('adminRouter.get("/settings/permissions", requireAuth, async'));
    assert.ok(source.includes('adminRouter.post("/analysis-log/auto-export", async'));
    assert.ok(source.includes('adminRouter.post("/public/send-report", reportMailLimiter, async'));
    assert.ok(source.includes('registerReportDeliveryRoutes(adminRouter, requireAuth, requireFeature("versandprotokoll"))'));
  });

  test("prompt/text/score/system features auto-register with admin-only defaults", async () => {
    const source = await readFile(new URL("../lib/admin-db.ts", import.meta.url), "utf8");
    const ids = /const ALL_FEATURE_IDS = \[([\s\S]*?)\];/.exec(source)[1];
    for (const feature of ["prompt_verwaltung", "textverwaltung", "score_einstellungen", "systemprotokoll"]) {
      assert.ok(ids.includes(`"${feature}"`));
    }
    assert.match(source, /if \(!\(id in current\)\) \{ current\[id\] = \["admin"\]; changed = true; \}/);
  });
}
