import assert from "node:assert/strict";
import { test } from "node:test";

const LOOKUP = "SELECT id, username, role FROM users WHERE id = $1";
export function currentUserAuthTests({ reset, request }) {
  test("authentication preserves missing and invalid/expired-token responses without querying users", async () => {
    for (const [token, error] of [
      [null, "Nicht authentifiziert"], ["invalid-token", "Sitzung abgelaufen"], ["expired-token", "Sitzung abgelaufen"],
    ]) {
      const state = reset();
      const result = await request("GET", "/settings/permissions", { token });
      assert.equal(result.statusCode, 401);
      assert.deepEqual(result.body, { error });
      assert.deepEqual(state.authQueries, []);
      assert.deepEqual(state.queries, []);
      assert.deepEqual(state.settingReads, []);
      assert.deepEqual(result.clearedCookies, []);
      assert.equal(result.adminUser, undefined);
    }
  });

  test("an admin token with a current database role user cannot enter requireAdmin routes", async () => {
    const state = reset();
    state.users.set(1, { id: 1, username: "renamed-user", role: "user" });
    for (const [method, path] of [
      ["GET", "/users"], ["POST", "/users"], ["PATCH", "/users/:id/role"], ["DELETE", "/users/:id"],
      ["PATCH", "/settings/permissions"], ["GET", "/settings/database"],
      ["POST", "/settings/database/test"],
    ]) {
      const result = await request(method, path, { token: "valid-admin", params: { id: "2" } });
      assert.equal(result.statusCode, 403, path);
      assert.deepEqual(result.body, { error: "Keine Berechtigung" });
      assert.deepEqual(result.adminUser, { id: 1, username: "renamed-user", role: "user" });
    }
    assert.equal(state.authQueries.length, 7);
    assert.ok(state.authQueries.every(([sql, params]) => sql === LOOKUP && params[0] === 1));
    assert.deepEqual(state.queries, []);
    assert.deepEqual(state.saved, []);
    assert.deepEqual(state.settingReads, []);
  });

  test("feature guards use the database role, never the admin role in an old token", async () => {
    const state = reset({ permissions_json: JSON.stringify({ ki_tool: ["user_extended"] }) });
    state.users.set(1, { id: 1, username: "renamed-user", role: "user" });
    const denied = await request("POST", "/settings/ai-test", { token: "valid-admin" });
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(state.preflightChecks, []);
    state.settings.permissions_json = JSON.stringify({ ki_tool: ["user"] });
    const allowed = await request("POST", "/settings/ai-test", { token: "valid-admin" });
    assert.equal(allowed.statusCode, 200);
    assert.equal(state.preflightChecks.length, 1);
    assert.deepEqual(allowed.adminUser, { id: 1, username: "renamed-user", role: "user" });
    assert.deepEqual(state.authQueries, [[LOOKUP, [1]], [LOOKUP, [1]]]);
  });

  test("every request reloads identity, including demotion, promotion and deletion with the same token", async () => {
    const state = reset();
    assert.equal((await request("GET", "/users", { guardsOnly: true })).statusCode, 200);
    state.users.set(1, { id: 1, username: "changed-name", role: "user" });
    assert.equal((await request("GET", "/users", { guardsOnly: true })).statusCode, 403);
    state.users.set(1, { id: 1, username: "changed-name", role: "admin" });
    const promoted = await request("GET", "/users", { guardsOnly: true });
    assert.equal(promoted.statusCode, 200);
    assert.deepEqual(promoted.adminUser, { id: 1, username: "changed-name", role: "admin" });
    state.users.delete(1);
    const deleted = await request("GET", "/users", { guardsOnly: true });
    assert.equal(deleted.statusCode, 401);
    assert.deepEqual(deleted.body, { error: "Sitzung ungültig" });
    assert.deepEqual(deleted.clearedCookies, [["gaio_admin_token", { path: "/" }]]);
    assert.equal(state.authQueries.length, 4);
    assert.deepEqual(state.queries, []);
  });

  test("a deleted user's token clears the cookie with the same options as logout and calls no handler", async () => {
    for (const token of ["valid-admin", "valid-user", "valid-extended"]) {
      const state = reset();
      state.users.clear();
      const deleted = await request("GET", "/settings/permissions", { token });
      const logout = await request("POST", "/logout");
      assert.equal(deleted.statusCode, 401);
      assert.deepEqual(deleted.body, { error: "Sitzung ungültig" });
      assert.deepEqual(deleted.clearedCookies, logout.clearedCookies);
      assert.deepEqual(deleted.clearedCookies, [["gaio_admin_token", { path: "/" }]]);
      assert.equal(deleted.adminUser, undefined);
      assert.equal(state.authQueries.length, 1);
      assert.deepEqual(state.queries, []);
      assert.deepEqual(state.settingReads, []);
    }
  });

  test("user-lookup errors return the exact 500 without token-role fallback or handler execution", async () => {
    for (const [method, path] of [["GET", "/settings/permissions"], ["GET", "/users"], ["POST", "/settings/ai-test"]]) {
      const state = reset({ permissions_json: JSON.stringify({ ki_tool: ["admin"] }) });
      state.authLookupError = new Error("Database unavailable");
      const result = await request(method, path);
      assert.equal(result.statusCode, 500);
      assert.deepEqual(result.body, { error: "Anmeldung konnte nicht geprüft werden" });
      assert.equal(result.adminUser, undefined);
      assert.deepEqual(result.clearedCookies, []);
      assert.deepEqual(state.authQueries, [[LOOKUP, [1]]]);
      assert.deepEqual(state.queries, []);
      assert.deepEqual(state.settingReads, []);
      assert.deepEqual(state.preflightChecks, []);
      assert.deepEqual(state.saved, []);
    }
  });

  test("database username and role override stale claims in a basic user's token", async () => {
    const state = reset();
    state.users.set(2, { id: 2, username: "renamed-admin", role: "admin" });
    const result = await request("GET", "/users", { token: "valid-user", guardsOnly: true });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.adminUser, { id: 2, username: "renamed-admin", role: "admin" });
    assert.deepEqual(state.authQueries, [[LOOKUP, [2]]]);
  });
}
