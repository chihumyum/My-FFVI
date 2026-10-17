import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("all PR battle-background prefabs retain every sprite and particle renderer", async () => {
  const read = async (file) =>
      JSON.parse(await readFile(new URL(`../../build/web-data/${file}`, import.meta.url))),
    [source, tables, result] = await Promise.all(
      ["raw/index.json", "raw/tables.json", "particles.json"].map(read),
    );
  const packages = source.files.filter((row) => /\/bg_ff6_/.test(row.file));
  for (const source of packages) {
    const asset = source.file.split("/").at(-1).split("_assets_")[0];
    const effect = result.effects[asset];
    assert.ok(effect, `Missing background prefab ${asset}`);
    assert.ok(effect.prefabRoots.includes("BgPrefab"), `${asset}: source root is required`);
    assert.equal(effect.systems.length, source.counts.ParticleSystem || 0, asset);
    assert.equal(effect.sprites.length, source.counts.SpriteRenderer || 0, asset);
  }
  for (const row of tables["battle_background_asset.csv"]) {
    const asset = row.asset_name.trim().toLowerCase();
    assert.equal(result.backgrounds[row.id.trim()], asset);
    assert.ok(result.effects[asset], `Background table ${row.id}: ${asset}`);
  }
  assert.deepEqual(
    result.warnings.filter(
      (row) =>
        row.effect?.startsWith("bg_ff6_") && ["texture", "SpriteRenderer"].includes(row.module),
    ),
    [],
    "Background texture references must resolve; material approximations remain separately logged",
  );
});
