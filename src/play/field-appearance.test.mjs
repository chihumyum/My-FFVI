import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "./game.js";

const tables = JSON.parse(
  await readFile(new URL("../../build/web-data/raw/tables.json", import.meta.url)),
);

test("all PR character selectors resolve character_id, including transformed Terra, doubles and vehicles", () => {
  const rows = tables["field_character_asset.csv"];
  const game = new PlayGame({
    data: { programs: {}, fieldAssets: Object.fromEntries(rows.map((row) => [row.id, row])) },
  });
  for (const row of rows) {
    const selector = -Number(row.character_id);
    assert.equal(
      game.actor(selector).asset,
      row.asset_name,
      `PR character ${row.character_id}, table row ${row.id}`,
    );
  }
  assert.equal(game.actor(-200).asset, "mo_ff6_p016");
  assert.equal(game.actor(-201).asset, "mo_ff6_p015");
  assert.equal(game.actor(-202).asset, "mo_ff6_p021_c01");
  assert.equal(game.actor(-103).asset, "mo_ff6_v004_c00");
});

test("every literal PR SetPuppet character binding resolves an existing character catalog", async () => {
  const data = JSON.parse(
    await readFile(new URL("../../build/web-data/data.json", import.meta.url)),
  );
  const game = new PlayGame({ data });
  const rows = new Map(
    tables["field_character_asset.csv"].map((row) => [Number(row.character_id), row]),
  );
  for (const program of Object.values(data.programs))
    for (const [pc, [name, integers]] of program.ops.entries()) {
      const selector = integers[1];
      if (name !== "SetPuppet" || selector >= 0 || selector <= -1000) continue;
      const row = rows.get(-selector);
      assert(row, `${program.name}:${pc} must resolve its literal character selector ${selector}`);
      const asset = game.actor(selector).asset;
      assert.equal(asset, row.asset_name);
      assert(
        data.characters[asset]?.sprites,
        `${program.name}:${pc} must not resolve a nonexistent sprite catalog`,
      );
    }
});

test("older saves repair nonexistent numeric puppet sprites while retaining authored overrides", async () => {
  const rows = tables["field_character_asset.csv"];
  const game = new PlayGame({
    data: { programs: {}, fieldAssets: Object.fromEntries(rows.map((row) => [row.id, row])) },
  });
  const saved = structuredClone(game.snapshot());
  saved.actors = [
    ["-200", { id: -200, asset: "mo_ff6_p200" }],
    ["-201", { id: -201, asset: "mo_ff6_p021" }],
  ];
  const before = structuredClone(saved);
  game.enter = async () => {
    game.map = { entities: [], groups: {} };
  };
  await game.restore(saved);
  assert.equal(game.actor(-200).asset, "mo_ff6_p016");
  assert.equal(game.actor(-201).asset, "mo_ff6_p021");
  assert.deepEqual(saved, before);
});
