import assert from "node:assert/strict";
import { test } from "node:test";

const row = (id, pattern, is_active = true, count_in_report = true) => ({
  id, pattern, is_active, count_in_report, note: null,
  created_at: "2026-10-14T09:00:00Z", updated_at: "2026-10-14T09:00:00Z",
});
function setup(reset, rows = []) {
  const state = reset({ permissions_json: JSON.stringify({ crawl_ausschluesse: ["user_extended"] }) });
  state.rules = new Map(rows.map(item => [item.id, structuredClone(item)]));
  state.crawlQuery = (sql, params = []) => {
    if (state.ruleDbError) throw new Error("synthetic database failure");
    if (sql.startsWith("SELECT")) {
      if (sql.includes("WHERE id")) return { rows: state.rules.has(params[0]) ? [structuredClone(state.rules.get(params[0]))] : [] };
      assert.match(sql, /ORDER BY pattern$/);
      return { rows: [...state.rules.values()].sort((a, b) => a.pattern.localeCompare(b.pattern)).map(item => structuredClone(item)) };
    }
    if (sql.startsWith("INSERT") || sql.startsWith("UPDATE")) {
      const [pattern, is_active, count_in_report, note, updateId] = params;
      if ([...state.rules.values()].some(item => item.pattern === pattern && item.id !== updateId)) {
        throw Object.assign(new Error("synthetic duplicate"), { code: "23505" });
      }
      const id = updateId ?? Math.max(0, ...state.rules.keys()) + 1;
      const before = state.rules.get(id);
      const next = { ...row(id, pattern, is_active, count_in_report), ...before, pattern, is_active, count_in_report, note };
      if (updateId) next.updated_at = "2026-10-14T10:00:00Z";
      state.rules.set(id, next);
      return { rows: [structuredClone(next)] };
    }
    if (sql.startsWith("DELETE")) {
      const before = state.rules.get(params[0]);
      state.rules.delete(params[0]);
      return { rows: before ? [before] : [] };
    }
    assert.fail(`Unexpected query: ${sql}`);
  };
  return state;
}

export function crawlExclusionRouteTests({ reset, request }) {
  test("crawl rule list returns all fields, including inactive rules, sorted by pattern", async () => {
    setup(reset, [row(1, "zahlung"), row(2, "account", false)]);
    const response = await request("GET", "/crawl-exclusions", { token: "valid-extended" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, [row(2, "account", false), row(1, "zahlung")]);
  });
  test("create and update validate every pattern restriction and note/boolean types", async () => {
    const state = setup(reset, [row(1, "existing")]);
    for (const body of [
      { pattern: "" }, { pattern: "   " }, { pattern: "foo bar" }, { pattern: "foo\tbar" },
      ...["/", "?", "&", "=", "#"].map(character => ({ pattern: `ab${character}cd` })),
      ...["*", "**", "a*", "a".repeat(101)].map(pattern => ({ pattern })),
      { pattern: "valid", note: "x".repeat(301) }, { pattern: "valid", note: 42 },
      { pattern: "valid", is_active: "true" }, { pattern: "valid", count_in_report: 1 },
      { pattern: 42 }, { pattern: "valid", userId: 3 },
    ]) {
      for (const [method, path] of [["POST", "/crawl-exclusions"], ["PATCH", "/crawl-exclusions/:id"]]) {
        const response = await request(method, path, { body, params: { id: "1" } });
        assert.equal(response.statusCode, 400, `${method} ${JSON.stringify(body)}`);
        assert.ok(typeof response.body.error === "string" && response.body.error.length > 5);
      }
    }
    assert.equal((await request("PATCH", "/crawl-exclusions/:id", { body: {}, params: { id: "1" } })).statusCode, 400);
    assert.equal(state.ruleInvalidations, 0);
    assert.equal(state.rules.size, 1);
  });
  test("valid patterns are NFC/trim/lowercase-normalized and create defaults are true", async () => {
    const state = setup(reset);
    for (const [input, expected] of [[" Registrierung ", "registrierung"], ["*REGISTR*", "*registr*"], [" KU\u0308NDIGUNG ", "kündigung"]]) {
      const result = await request("POST", "/crawl-exclusions", { body: { pattern: input } });
      assert.equal(result.statusCode, 201);
      assert.equal(result.body.pattern, expected);
      assert.equal(result.body.is_active, true);
      assert.equal(result.body.count_in_report, true);
      assert.equal(result.body.note, null);
    }
    assert.equal(state.ruleInvalidations, 3);
  });
  test("create and edit duplicates return409 with the normalized existing pattern and no invalidation", async () => {
    const state = setup(reset, [row(1, "registrierung"), row(2, "other")]);
    for (const [method, path] of [["POST", "/crawl-exclusions"], ["PATCH", "/crawl-exclusions/:id"]]) {
      const result = await request(method, path, { body: { pattern: " REGISTRIERUNG " }, params: { id: "2" } });
      assert.equal(result.statusCode, 409);
      assert.match(result.body.error, /registrierung/);
    }
    assert.equal(state.ruleInvalidations, 0);
    assert.equal(state.rules.get(2).pattern, "other");
  });
  test("partial edits preserve omitted fields, update timestamp, invalidate and audit before/after", async () => {
    const original = row(1, "registrierung");
    const state = setup(reset, [original]);
    const result = await request("PATCH", "/crawl-exclusions/:id", {
      token: "valid-extended", params: { id: "1" }, body: { is_active: false, note: "" },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.pattern, "registrierung");
    assert.equal(result.body.is_active, false);
    assert.equal(result.body.count_in_report, true);
    assert.equal(result.body.note, "");
    assert.notEqual(result.body.updated_at, original.updated_at);
    assert.equal(state.ruleInvalidations, 1);
    assert.deepEqual(state.infos.at(-1), [{
      action: "update", id: 1, pattern: "registrierung", before: original, after: result.body, userId: 3,
    }, "crawl exclusion rule changed"]);
    assert.ok(state.transactionCalls.some(call => Array.isArray(call) && /FOR UPDATE/.test(call[0])));
    assert.equal(state.transactionCalls.at(-1), "COMMIT");
  });
  test("create and delete audit identity and content and hard-delete only the requested row", async () => {
    const state = setup(reset);
    const created = await request("POST", "/crawl-exclusions", { body: { pattern: "registrierung", count_in_report: false } });
    assert.equal(state.infos.at(-1)[0].action, "create");
    assert.equal(state.infos.at(-1)[0].userId, 1);
    assert.deepEqual(state.infos.at(-1)[0].after, created.body);
    const deleted = await request("DELETE", "/crawl-exclusions/:id", { params: { id: String(created.body.id) } });
    assert.deepEqual(deleted.body, { ok: true });
    assert.equal(state.rules.size, 0);
    assert.equal(state.ruleInvalidations, 2);
    assert.equal(state.infos.at(-1)[0].action, "delete");
    assert.deepEqual(state.infos.at(-1)[0].before, created.body);
    assert.equal(state.infos.at(-1)[0].after, undefined);
  });
  test("test endpoint bypasses cache, includes inactive matches and derives flags only from active rules", async () => {
    const state = setup(reset, [row(1, "*registr*", false), row(2, "registrierung", true, false), row(3, "other")]);
    const body = { url: "https://vaupel-info.de/registrierung" };
    const first = await request("POST", "/crawl-exclusions/test", { body });
    assert.equal(first.body.excluded, true);
    assert.equal(first.body.countedInReport, false);
    assert.deepEqual(first.body.matches.map(item => item.id), [1, 2]);
    assert.equal(first.body.matches[0].is_active, false);
    state.rules.get(2).count_in_report = true;
    assert.equal((await request("POST", "/crawl-exclusions/test", { body })).body.countedInReport, true);
    state.rules.get(2).is_active = false;
    const inactive = await request("POST", "/crawl-exclusions/test", { body });
    assert.equal(inactive.body.excluded, false);
    assert.equal(inactive.body.countedInReport, false);
    assert.equal(inactive.body.matches.length, 2);
    assert.equal(state.ruleInvalidations, 0);
    assert.equal((await request("POST", "/crawl-exclusions/test", { body: { url: "https://registrierung.example.test/products#registrierung" } })).body.matches.length, 0);
  });
  test("invalid test URLs, invalid IDs, missing rules and database errors fail without invalidation", async () => {
    const state = setup(reset);
    for (const url of ["", "not-url", "/relative", "javascript:alert(1)", null]) {
      assert.equal((await request("POST", "/crawl-exclusions/test", { body: { url } })).statusCode, 400);
    }
    for (const method of ["PATCH", "DELETE"]) {
      for (const id of ["0", "-1", "x", "1 OR 1=1", "9007199254740993"]) {
        assert.equal((await request(method, "/crawl-exclusions/:id", { params: { id }, body: { note: "text" } })).statusCode, 400);
      }
      assert.equal((await request(method, "/crawl-exclusions/:id", { params: { id: "42" }, body: { note: "text" } })).statusCode, 404);
    }
    state.ruleDbError = true;
    assert.equal((await request("GET", "/crawl-exclusions")).statusCode, 500);
    assert.equal(state.ruleInvalidations, 0);
  });
}
