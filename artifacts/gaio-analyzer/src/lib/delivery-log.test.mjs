import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

async function bundleEntry(entry) {
  const { outputFiles } = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", write: false, jsx: "automatic",
    define: { "import.meta.env.BASE_URL": '"/"' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
}
const read = p => readFile(new URL(p, import.meta.url), "utf8");
const { ADMIN_FEATURES, ADMIN_NAV_GROUPS } = await bundleEntry("../config/adminFeatures.ts");
const { labelDefaults } = await bundleEntry("./labelDefaults.ts");
const { canAccess } = await bundleEntry("../store/authStore.tsx");

test("versandprotokoll registered as feature and nav item after versand_analyse", () => {
  const f = ADMIN_FEATURES.find(x => x.id === "versandprotokoll");
  assert.ok(f);
  assert.equal(f.label, "nav.admin_versandprotokoll");
  assert.equal(f.icon, "Inbox");
  assert.deepEqual(f.defaultRoles, ["admin"]);
  const items = ADMIN_NAV_GROUPS.find(g => g.id === "analysen").items;
  assert.equal(items.indexOf("versandprotokoll"), items.indexOf("versand_analyse") + 1);
});

test("sidebar, store and home map view 23", async () => {
  assert.match(await read("../components/layout/Sidebar.tsx"), /versandprotokoll: 23/);
  assert.match(await read("../components/layout/Sidebar.tsx"), /versandprotokoll: Inbox/);
  assert.match(await read("../store/appStore.tsx"), /\| 22 \| 23 \| 24 \| 25;/);
  assert.match(await read("../pages/Home.tsx"), /activeView === 23\s+&& <DeliveryLogView \/>/);
});

test("every label literal used by the view exists with German default", async () => {
  const src = await read("../views/admin/DeliveryLogView.tsx");
  const keys = new Set([...src.matchAll(/["'`]((?:deliverylog|nav)\.[a-z_]+)["'`]/g)].map(m => m[1]));
  assert.ok(keys.size > 30);
  for (const k of keys) assert.ok(labelDefaults[k]?.de, `missing ${k}`);
  assert.equal(labelDefaults["deliverylog.delete_confirm"].de, "Diesen Eintrag endgültig löschen? Das kann nicht rückgängig gemacht werden.");
  assert.equal(labelDefaults["deliverylog.csv_export"].group, "admin");
});

test("permission gating: admin always, delegated roles, default deny", () => {
  assert.equal(canAccess("versandprotokoll", "admin", {}), true);
  assert.equal(canAccess("versandprotokoll", "user_extended", {}), false);
  assert.equal(canAccess("versandprotokoll", "user_extended", { versandprotokoll: ["admin", "user_extended"] }), true);
  assert.equal(canAccess("versandprotokoll", "user", { versandprotokoll: ["admin", "user_extended"] }), false);
});

test("view uses cookie auth, q param, consent filter, canAccess and session guards", async () => {
  const src = await read("../views/admin/DeliveryLogView.tsx");
  assert.match(src, /adminFetch\(`\/api\/admin\/report-deliveries\?/);
  assert.match(src, /params\.set\("q"/);
  assert.doesNotMatch(src, /params\.set\("search"/);
  assert.match(src, /params\.set\("consent", "only"\)/);
  assert.match(src, /export\.csv\?/);
  assert.match(src, /canAccess\("versandprotokoll"/);
  assert.doesNotMatch(src, /role === "admin"/);
  assert.match(src, /generation\.current !== gen|gen !== generation\.current/);
  assert.match(src, /setData\(null\)/);
  assert.doesNotMatch(src, /<a\s/);
  assert.match(src, /setPage\(page - 1\)/);
});
