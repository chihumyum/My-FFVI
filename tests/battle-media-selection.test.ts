import assert from "node:assert/strict";
import test from "node:test";
import { validateBattleMediaSelection } from "../src/compiler/battle.js";

function fixture() {
  const master = "master_assets_all_source.bundle";
  const monsterBundles = ["mn_ff6_001_assets_all_source.bundle", "mn_ff6_002_assets_all_source.bundle"];
  const backgroundBundles = ["bg_ff6_01_assets_all_source.bundle", "bg_ff6_02_assets_all_source.bundle"];
  const tableNames = ["monster_party.csv", "monster.csv", "monster_asset.csv", "battle_background_asset.csv"];
  const source = (file: string, assetPath: string, objectId = "9007199254740993") =>
    ({ file, assetPath, objectId, serializedFile: "CAB-" + file });
  const picture = (file: string, path: string, digit: string) => ({
    source: source(file, path), name: path.split("/").at(-1)!, file: "sprites/" + digit.repeat(64) + ".png",
    sha256: digit.repeat(64), representation: "source-texture-full-rect", width: 32, height: 64,
    pivot: [.5, .25], pixelsPerUnit: 2, textureWrap: [1, 1], filterMode: 0,
  });
  const paths = [
    "Assets/Monster/MN_FF6_001/MN_FF6_001_C00.png",
    "Assets/Monster/MN_FF6_001/MN_FF6_001_C01.png",
    "Assets/Monster/MN_FF6_002/MN_FF6_002_C00.png",
    "Assets/Background/BG_FF6_01/BG_FF6_01.png",
    "Assets/Background/BG_FF6_02/BG_FF6_02.png",
  ];
  const exported = {
    formatVersion: 1, adapterVersion: "battle-0.4.0", characterIds: [1],
    parentSourceSetHash: "a".repeat(64), sourceSetHash: "b".repeat(64), encounterPartyIds: [700],
    sources: [master, ...monsterBundles, ...backgroundBundles].map(file => ({ file, sha256: "c".repeat(64), bytes: 100 })),
    assets: {},
    sprites: Object.fromEntries(paths.map((path, i) => [path,
      picture(i < 2 ? monsterBundles[0]! : i === 2 ? monsterBundles[1]! : backgroundBundles[i - 3]!, path, String(i + 1))])),
    tableSources: Object.fromEntries(tableNames.map(name => [name, source(master, "Assets/Master/" + name)])),
    mediaSelection: { kind: "media-selection-v1", monsters: { mode: "all", masterIds: [4, 31, 97] },
      backgrounds: { mode: "all", masterIds: [1, 2] } },
  };
  const party: Record<string, string> = { id: "700", battle_background_asset_id: "1" };
  for (let slot = 1; slot <= 9; slot++) party["monster" + slot] = slot === 2 || slot === 8 ? "31" : "0";
  const tables = {
    "monster_party.csv": [party],
    "monster.csv": [{ id: "97", monster_asset_id: "13" }, { id: "31", monster_asset_id: "12" }, { id: "4", monster_asset_id: "11" }],
    "monster_asset.csv": [{ id: "11", group_name: "mn_ff6_001", asset_name: "c00" },
      { id: "12", group_name: "mn_ff6_001", asset_name: "c01" }, { id: "13", group_name: "mn_ff6_002", asset_name: "c00" }],
    "battle_background_asset.csv": [{ id: "2", asset_name: "bg_ff6_02" }, { id: "1", asset_name: "bg_ff6_01" }],
  };
  return { exported, tables, paths };
}

test("all-master media binds nonparty masters and preserves source IDs, requests and geometry", () => {
  const { exported, tables } = fixture(), before = structuredClone({ exported, tables });
  validateBattleMediaSelection(exported, tables);
  assert.deepEqual({ exported, tables }, before);
  assert.deepEqual(exported.encounterPartyIds, [700]);
  assert.equal(exported.sprites["Assets/Monster/MN_FF6_002/MN_FF6_002_C00.png"]!.source.objectId, "9007199254740993");
});

test("mixed scopes use exact encounter references rather than all exported shared sprites", () => {
  const { exported, tables } = fixture();
  exported.mediaSelection.monsters = { mode: "encounters", masterIds: [31] };
  validateBattleMediaSelection(exported, tables);
  exported.mediaSelection.monsters.masterIds.push(97);
  assert.throws(() => validateBattleMediaSelection(exported, tables), /selection disagrees/);
  const second = fixture();
  second.exported.mediaSelection.backgrounds = { mode: "encounters", masterIds: [1] };
  validateBattleMediaSelection(second.exported, second.tables);
});

test("a claimed all scope cannot omit an unreferenced master or add another identity", () => {
  for (const masterIds of [[4, 31], [4, 31, 97, 999]]) {
    const { exported, tables } = fixture(); exported.mediaSelection.monsters.masterIds = masterIds;
    assert.throws(() => validateBattleMediaSelection(exported, tables), /selection disagrees/);
  }
  for (const masterIds of [[4, 31, 31, 97], [31, 4, 97], [0, 4, 31, 97]]) {
    const { exported, tables } = fixture(); exported.mediaSelection.monsters.masterIds = masterIds;
    assert.throws(() => validateBattleMediaSelection(exported, tables));
  }
});

test("media declarations are versioned and the old export gains no implicit requirement", () => {
  const f = fixture(), { mediaSelection: _, ...legacy } = f.exported;
  legacy.adapterVersion = "battle-0.3.0";
  const before = JSON.stringify(legacy);
  validateBattleMediaSelection(legacy, {});
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(Object.hasOwn(legacy, "mediaSelection"), false);
  assert.throws(() => validateBattleMediaSelection({ ...legacy, mediaSelection: f.exported.mediaSelection }, f.tables), /adapter version/);
  assert.throws(() => validateBattleMediaSelection({ ...legacy, adapterVersion: "battle-0.4.0" }, f.tables), /adapter version/);
  const declared = fixture();
  declared.exported.mediaSelection.monsters = { mode: "encounters", masterIds: [31] };
  declared.exported.mediaSelection.backgrounds = { mode: "encounters", masterIds: [1] };
  assert.throws(() => validateBattleMediaSelection(declared.exported, declared.tables), /all-master scope/);
});

test("a true master list still needs the actual unique sprite and source bundle binding", () => {
  const missing = fixture(); delete missing.exported.sprites[missing.paths[2]!];
  assert.throws(() => validateBattleMediaSelection(missing.exported, missing.tables), /selected battle media sprite/);
  const ambiguous = fixture(), path = ambiguous.paths[2]!;
  ambiguous.exported.sprites["Assets/Other/MN_FF6_002_C00.png"] = structuredClone(ambiguous.exported.sprites[path]!);
  assert.throws(() => validateBattleMediaSelection(ambiguous.exported, ambiguous.tables), /selected battle media sprite/);
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.exported.sprites[f.paths[2]!]!.source.file = "mn_ff6_001_assets_all_source.bundle"; },
    (f: ReturnType<typeof fixture>) => { f.exported.sprites[f.paths[2]!]!.source.assetPath = f.paths[0]!; },
    (f: ReturnType<typeof fixture>) => { f.exported.sprites[f.paths[2]!]!.file = "sprites/missing.png"; },
    (f: ReturnType<typeof fixture>) => { f.exported.sprites[f.paths[2]!]!.source.objectId = "00097"; },
    (f: ReturnType<typeof fixture>) => { f.exported.sprites[f.paths[2]!]!.source.objectId = "9223372036854775808"; },
    (f: ReturnType<typeof fixture>) => { f.exported.sprites[f.paths[2]!]!.source.serializedFile = ""; },
  ]) {
    const f = fixture(); change(f);
    assert.throws(() => validateBattleMediaSelection(f.exported, f.tables), /media source/);
  }
});

test("all-media selection retains missing-party, table and asset-reference failures", () => {
  const missingAsset = fixture(); missingAsset.tables["monster.csv"][0]!.monster_asset_id = "99";
  assert.throws(() => validateBattleMediaSelection(missingAsset.exported, missingAsset.tables), /monster_asset.csv:99/);
  const duplicate = fixture(); duplicate.tables["monster.csv"].push({ ...duplicate.tables["monster.csv"][0]! });
  assert.throws(() => validateBattleMediaSelection(duplicate.exported, duplicate.tables), /Duplicate.*monster.csv/);
  const dangling = fixture(); dangling.tables["monster_party.csv"][0]!.monster8 = "999";
  assert.throws(() => validateBattleMediaSelection(dangling.exported, dangling.tables), /monster.csv:999/);
  const movedTable = fixture(); movedTable.exported.tableSources["monster.csv"]!.assetPath = "Assets/Master/monster_asset.csv";
  assert.throws(() => validateBattleMediaSelection(movedTable.exported, movedTable.tables), /table source/);
  const inventedMaster = fixture(); inventedMaster.tables["monster.csv"][0]!.id = "097";
  assert.throws(() => validateBattleMediaSelection(inventedMaster.exported, inventedMaster.tables), /media source identity/);
});
