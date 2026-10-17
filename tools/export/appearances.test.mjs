import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileAppearanceConditions } from "./appearances.mjs";
import { partyFieldAsset } from "../../src/play/appearance.js";

test("all PR misc appearance conditions resolve field character IDs and clear back to the party body", async () => {
  const root = new URL("../../build/web-data/", import.meta.url),
    tables = JSON.parse(await readFile(new URL("raw/tables.json", root))),
    index = JSON.parse(await readFile(new URL("raw/index.json", root))),
    file = index.files.find((row) => /\/misc_assets_all_/.test(row.file)),
    assets = JSON.parse(await readFile(new URL(file.bundleOutput, root))),
    source = assets.flatMap((row) => row.data.change_character_condition_list || []),
    rules = compileAppearanceConditions(tables, assets),
    data = {
      appearanceConditions: rules,
      fieldAssets: Object.fromEntries(
        tables["field_character_asset.csv"].map((row) => [row.id, row]),
      ),
    };
  assert.equal(source.length, 3);
  assert.equal(rules.length, 3);
  for (const change of source) {
    const condition = tables["condition.csv"].find(
        (row) => row.condition_type === String(change.condition_type),
      ),
      expected = tables["field_character_asset.csv"].find(
        (row) => row.character_id === String(change.field_character_asset_cid),
      );
    assert(expected);
    for (const id of [1, 2, 7]) {
      assert.equal(
        partyFieldAsset(data, { id, conditions: [Number(condition.id)] }),
        expected.asset_name,
      );
      assert.equal(
        partyFieldAsset(data, { id, conditions: [] }),
        `mo_ff6_p${String(id).padStart(3, "0")}`,
      );
    }
  }
});
