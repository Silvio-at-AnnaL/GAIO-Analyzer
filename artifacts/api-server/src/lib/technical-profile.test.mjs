import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const settings = new Map();
globalThis.__technicalProfileSettings = settings;
const { outputFiles } = await build({
  entryPoints: [new URL("./score-config.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{
    name: "no-database",
    setup(b) {
      b.onResolve({ filter: /admin-db/ }, () => ({ path: "db", namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: `
        export const getSetting = async key => globalThis.__technicalProfileSettings.get(key) ?? null;
        export const setSetting = async (key,value) => globalThis.__technicalProfileSettings.set(key,value);
      ` }));
    },
  }],
});
const { SCORE_PROFILES, getScoreParams, setScoreParam } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
test("technical profile exposes all 22 params with requested defaults, bounds and increments", async () => {
  const profile = SCORE_PROFILES.find(p => p.slug === "technical");
  assert.equal(profile.label, "score.profile_technical");
  assert.equal(profile.params.length, 22);
  const params = await getScoreParams("technical");
  assert.deepEqual(Object.fromEntries(profile.params.map(p => [p.key, p.default])), params);
  assert.equal(Object.entries(params).filter(([key]) => key.startsWith("weight_")).reduce((sum, [,v]) => sum + v, 0), 100);
  for (const def of profile.params) {
    assert.equal(def.label, `score.param_${def.key}_label`);
    assert.equal(def.help, `score.param_${def.key}_help`);
    if (def.key.startsWith("weight_")) assert.deepEqual([def.min, def.max, def.step], [0, 40, 1]);
  }
  for (const [key, expected] of Object.entries({
    title_min: [5,40,1], title_max: [40,120,1], desc_min: [20,120,1], desc_max: [120,300,1],
    length_factor: [0,1,.05], duplicate_factor: [0,1,.05], html_sitemap_credit: [0,1,.05],
    response_good_ms: [200,5000,100], response_ok_ms: [500,8000,100], response_ok_credit: [0,1,.05],
  })) {
    const def = profile.params.find(p => p.key === key);
    assert.deepEqual([def.min,def.max,def.step], expected, key);
  }
});
test("each technical parameter can be saved and loaded using the generic settings path", async () => {
  for (const def of SCORE_PROFILES.find(p => p.slug === "technical").params) {
    const value = def.default === def.min ? def.max : def.min;
    await setScoreParam("technical", def.key, value);
    assert.equal((await getScoreParams("technical"))[def.key], value, def.key);
  }
});
