import test from "node:test";
import assert from "node:assert/strict";
import { battleTableIndex } from "../src/compiler/battle.js";
import { compileBattleAppearance } from "../src/compiler/battle-appearance.js";
import { hasMagitekBehavior } from "../src/compiler/conditions.js";
import { appearanceFixture } from "./fixtures/battle-appearance.js";

function fixture() {
  const runtime = appearanceFixture();
  const source = { file: "synthetic.bundle", assetPath: "Assets/synthetic.csv", objectId: "9007199254740993", serializedFile: "synthetic-cab" };
  const condition: Record<string, string> = Object.fromEntries([
    "until_value", "overlapped_type", "invalid_type", "target_type", "condition_group_id", "parameter_group_id",
    "attribute_group_id", "species_group_id", "rate_type1", "rate_type2", "rate_value1", "rate_value2", "recovery_invalid",
    "attack_target", "game_over_target", "state_cover_unavailable", "damage_number", "battle_effect_asset_id",
    "battle_effect_shadow_cloning", "field_se_asset_id", "icon_id",
  ].map((key) => [key, "0"]));
  Object.assign(condition, { id: "153", condition_type: "607", system_type: "4", resistance_decision: "1", until_type: "3", mes_id_name: "None" });
  const tables = {
    "condition.csv": [condition], "battle_effect_asset.csv": [{ id: "99" }],
    "game_constant_int.csv": [
      { id: "1", key_name: "CHARACTER_MOG_ASSET_POSTURE", value1: "11" },
      { id: "2", key_name: "CHARACTER_MADOU_ASSET_POSTURE", value1: "200" },
      { id: "3", key_name: "CHARACTER_MADOU_ASSET_POSTURE_50", value1: "250" },
    ],
    "character_status.csv": [{ id: "101", character_asset_id: "201" }],
    "character_asset.csv": [{ id: "201", asset_name: "synthetic_body", size_type: "3" }],
  };
  const sprites: Parameters<typeof compileBattleAppearance>[1]["sprites"] = {};
  for (const [group, shapes] of [["synthetic_body", runtime.actor.bodyGeometry], ["bc_ff6_p022", runtime.catalog.armorGeometry]] as const) {
    for (const [name, geometry] of Object.entries(shapes)) {
      const key = `Assets/${group}/${name}.png`, sha256 = "a".repeat(64);
      sprites[key] = { source: { ...source, assetPath: key }, name, file: `sprites/${sha256}.png`, sha256,
        representation: "source-texture-full-rect", ...geometry };
    }
  }
  const misc = { source: { ...source, assetPath: "Assets/serial_misc_assets.json" }, data: {
    battle_anim_alias_table: Object.entries(runtime.catalog.aliases).map(([key, alias]) => ({
      key, names: alias.body, magic_armor_table: { anim_names: alias.armor, chara_offsets: alias.textureOffsets, chara_position: alias.positions },
    })),
  } };
  const compile = () => compileBattleAppearance(battleTableIndex(tables, Object.fromEntries(Object.keys(tables).map((key) => [key, source]))),
    { tables, sprites, misc, sourceIds: [101] });
  return { tables, sprites, misc, compile };
}
test("source compiler resolves condition, exact aliases, character asset and source sampling metadata", () => {
  const f = fixture(), result = f.compile();
  assert.deepEqual(result.blockers, []);
  assert.equal(result.catalog.conditionId, 153);
  assert.equal(result.actors[101]!.characterAssetId, 201);
  assert.equal(result.actors[101]!.sizeType, 3);
  assert.equal(result.actors[101]!.bodyGeometry.idle!.height, 32);
  assert.equal(result.catalog.armorGeometry.mount!.height, 40);
  assert.equal(result.catalog.aliases.move!.body.length, 2);
  assert.equal(result.catalog.aliases.move!.armor.length, 4);
  assert.ok(result.media.every((media) => media.source.objectId === "9007199254740993"));
});
test("altered source condition providers and effect ID zero rows cannot be called supported", () => {
  const f = fixture();
  assert.equal(hasMagitekBehavior({ values: f.tables["condition.csv"][0]! }), true);
  f.tables["condition.csv"][0]!.parameter_group_id = "1";
  assert.throws(f.compile, /Magitek behavior/);
  f.tables["condition.csv"][0]!.parameter_group_id = "0";
  f.tables["battle_effect_asset.csv"].push({ id: "0" });
  assert.throws(f.compile, /effect asset provider/);
});
test("missing poses and unsupported geometry block only the affected source character", () => {
  const f = fixture();
  delete f.sprites["Assets/synthetic_body/down.png"];
  assert.match(f.compile().blockers[0]!.reasons[0]!, /Missing.*media/);
  const bad = fixture(); bad.sprites["Assets/synthetic_body/idle.png"]!.textureWrap = [0, 1];
  assert.match(bad.compile().blockers[0]!.reasons[0]!, /geometry/);
});
test("duplicate aliases and missing transform constants cannot silently choose a default", () => {
  const f = fixture();
  f.misc.data.battle_anim_alias_table.push(f.misc.data.battle_anim_alias_table[0]!);
  assert.throws(f.compile, /duplicate/);
  const missing = fixture(); missing.tables["game_constant_int.csv"].pop();
  assert.throws(missing.compile, /Ambiguous/);
});
