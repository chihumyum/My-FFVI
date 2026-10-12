import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleEncounterSources, type BattleEncounterJson, type BattleEncounterSourceInput } from "../src/compiler/battle-encounters.js";
import { battleTableIndex } from "../src/compiler/battle.js";
import { aiSource } from "./fixtures/battle-ai.js";

function party(id: number, pattern = 1): Record<string, string> {
  const result: Record<string, string> = { id: String(id), appearance_production: "1", battle_background_asset_id: "50",
    battle_bgm_asset_id: "6", battle_flag_group_id: "7", get_ap: "0", get_value: "0", not_escape: "2", script_name: "500" };
  for (let i = 1; i <= 6; i++) result[`battle_pattern${i}`] = String(i === pattern ? 1 : 0);
  for (let i = 1; i <= 9; i++) Object.assign(result, { [`monster${i}`]: "0", [`monster${i}_group`]: "1",
    [`monster${i}_x_position`]: "0", [`monster${i}_y_position`]: "0" });
  Object.assign(result, { monster2: "11", monster2_x_position: "-12", monster2_y_position: "15",
    monster8: "12", monster8_group: pattern === 3 ? "2" : "1", monster8_x_position: "20", monster8_y_position: "-8" });
  return result;
}
function fixture() {
  const tables: Record<string, Record<string, string>[]> = {
    "monster_party.csv": [party(77), party(91, 3)],
    "monster.csv": [{ id: "11", monster_asset_id: "100", script_id: "200", resistance_attribute: "0" },
      { id: "12", monster_asset_id: "101", script_id: "201", resistance_attribute: "0" }],
    "monster_asset.csv": [{ id: "100", group_name: "MN_RED", asset_name: "C00" },
      { id: "101", group_name: "MN_BLUE", asset_name: "C01" }],
    "monster_ai_script.csv": [{ id: "200", script_name: "red_ai" }, { id: "201", script_name: "blue_ai" }],
    "ability.csv": [{ id: "10" }, { id: "11" }, { id: "12" }],
    "battle_background_asset.csv": [{ id: "50", asset_name: "BG_SYNTHETIC" }],
    "battle_flag_group.csv": [{ id: "44", group_id: "7", battle_flag_id: "14" }],
    "script.csv": [{ id: "500", script_name: "battle_script" }],
  };
  const sources = Object.fromEntries(Object.keys(tables).map((name) => [name, {
    file: "synthetic.bundle", assetPath: name, serializedFile: "synthetic", objectId: "-9223372036854775808",
  }]));
  const source = { ...sources["script.csv"]!, sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64),
    sha256: "c".repeat(64) };
  const assets: Record<string, BattleEncounterJson> = {
    red_ai: { source: { ...source, assetPath: "red_ai.json" }, data: aiSource([["SyncAI"], ["Act", [10]], ["Exit"]]) },
    blue_ai: { source: { ...source, assetPath: "blue_ai.json" }, data: aiSource([["SyncAI"], ["Act", [11]], ["Exit"]]) },
    battle_script: { source: { ...source, assetPath: "battle_script.json" }, data: aiSource([["UnknownBattleLifecycle", [2, 3]]]) },
  };
  const sprites = ["/MN_RED_C00.png", "/MN_BLUE_C01.png", "/BG_SYNTHETIC.png"];
  const calls: string[] = [];
  const input = (ids = [77, 91]): BattleEncounterSourceInput => ({ partyIds: ids,
    json: (name) => {
      calls.push(name);
      const found = assets[name];
      if (!found) throw new Error("Missing JSON " + name);
      return found;
    },
    spritePath: (suffix) => {
      calls.push(suffix);
      if (!sprites.includes(suffix)) throw new Error("Missing sprite " + suffix);
      return "Assets/Synthetic" + suffix;
    },
  });
  const reader = () => battleTableIndex(tables, sources);
  return { tables, sources, assets, sprites, calls, input, reader,
    compile: (ids = [77, 91]) => compileBattleEncounterSources(reader(), input(ids)) };
}

test("arbitrary party identities retain sparse source slots, signed placement and normal/opposed patterns", () => {
  const f = fixture(), result = f.compile([91, 77]);
  assert.deepEqual(result.requestedPartyIds, [77, 91]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.encounters.map((e) => [e.partyId, e.pattern, e.patterns]),
    [[77, 1, [1, 0, 0, 0, 0, 0]], [91, 3, [0, 0, 1, 0, 0, 0]]]);
  assert.deepEqual(result.encounters[1]!.enemies.map(({ slot, monsterId, group, x, y }) => ({ slot, monsterId, group, x, y })),
    [{ slot: 2, monsterId: 11, group: 1, x: -12, y: 15 }, { slot: 8, monsterId: 12, group: 2, x: 20, y: -8 }]);
  assert.equal(result.encounters[0]!.source.rowId, "77");
  assert.equal(result.encounters[0]!.enemies[0]!.sprite, "Assets/Synthetic/MN_RED_C00.png");
  assert.equal(result.encounters[0]!.background, "Assets/Synthetic/BG_SYNTHETIC.png");
});

test("party flags, BGM, reward modes and source battle scripts survive for separate runtime admission", () => {
  const f = fixture();
  Object.assign(f.tables["monster_party.csv"]![0]!, { get_ap: "7", get_value: "2", appearance_production: "3" });
  const result = f.compile([77]), entry = result.encounters[0]!;
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual({ ...entry.metadata, battleFlags: entry.metadata.battleFlags.map((r) => r.values) },
    { battleFlagGroupId: 7, battleFlags: [{ id: "44", group_id: "7", battle_flag_id: "14" }], backgroundId: 50,
      bgmId: 6, appearanceProduction: 3, notEscape: 2, getAp: 7, getValue: 2, scriptId: 500 });
  assert.deepEqual(entry.script, f.assets.battle_script);
  assert.equal(entry.metadata.battleFlags[0]!.source.rowId, "44");
});

test("zero script/group references are explicit absence and do not resolve row zero", () => {
  const f = fixture();
  Object.assign(f.tables["monster_party.csv"]![0]!, { script_name: "0", battle_flag_group_id: "0" });
  delete f.tables["script.csv"]; delete f.tables["battle_flag_group.csv"];
  const result = f.compile([77]);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.encounters[0]!.script, null);
  assert.deepEqual(result.encounters[0]!.metadata.battleFlags, []);
  assert.equal(f.calls.includes("battle_script"), false);
});

test("pattern six, multiple eligible patterns and invalid bits remain per-party diagnostics", () => {
  for (const patterns of [[0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1], [1, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0]]) {
    const f = fixture(), first = f.tables["monster_party.csv"]![0]!;
    patterns.forEach((value, index) => { first[`battle_pattern${index + 1}`] = String(value); });
    const result = f.compile();
    assert.deepEqual(result.encounters.map((e) => e.partyId), [91]);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0]!.partyId, 77);
    assert.equal(result.diagnostics[0]!.code, "formation");
    assert.equal(result.diagnostics[0]!.dependency?.field, "battle_pattern1..6");
    assert.match(result.diagnostics[0]!.reason, new RegExp(patterns.join(",")));
  }
});

test("missing source columns are diagnosed instead of defaulting to zero", () => {
  for (const key of ["battle_pattern6", "script_name", "not_escape", "get_ap", "monster2_x_position"]) {
    const f = fixture(); delete f.tables["monster_party.csv"]![0]![key];
    const result = f.compile();
    assert.deepEqual(result.encounters.map((e) => e.partyId), [91]);
    assert.equal(result.diagnostics[0]!.code, "invalid-source-value");
    assert.equal(result.diagnostics[0]!.dependency?.field, key);
  }
});

test("missing monster and script references block only their owning party and identify the exact dependency", () => {
  for (const [key, value, table] of [["monster2", "404", "monster.csv"], ["script_name", "404", "script.csv"]]) {
    const f = fixture(); f.tables["monster_party.csv"]![0]![key!] = value!;
    const result = f.compile();
    assert.deepEqual(result.encounters.map((e) => e.partyId), [91]);
    assert.equal(result.diagnostics[0]!.code, "table-reference");
    assert.deepEqual(result.diagnostics[0]!.dependency, { table, id: 404 });
    assert.equal(result.diagnostics[0]!.source?.rowId, "77");
  }
});

test("missing/ambiguous JSON or sprite assets retain a diagnostic instead of choosing a fallback", () => {
  const f = fixture(); delete f.assets.red_ai;
  let result = f.compile();
  assert.deepEqual(result.encounters, []);
  assert.deepEqual(result.diagnostics.map((d) => [d.partyId, d.code, d.dependency]),
    [77, 91].map((partyId) => [partyId, "asset-reference", { table: "monster_ai_script.csv", id: 200 }]));
  const g = fixture(), input = g.input();
  input.spritePath = () => { throw new Error("Ambiguous source sprite"); };
  result = compileBattleEncounterSources(g.reader(), input);
  assert.equal(result.diagnostics.length, 2);
  assert.match(result.diagnostics[0]!.reason, /Ambiguous source sprite/);
  assert.equal(result.diagnostics[0]!.source?.rowId, "100");
});

test("malformed AI reference encoding cannot later abort the whole batch ability collection", () => {
  const f = fixture(); f.assets.red_ai!.data = { Mnemonics: [{ mnemonic: "Act", operands: { iValues: ["12"] } }] };
  // The second group uses only the independent blue AI.
  f.tables["monster_party.csv"]![1]!.monster2 = "0";
  const result = f.compile();
  assert.deepEqual(result.encounters.map((e) => e.partyId), [91]);
  assert.equal(result.diagnostics[0]!.code, "asset-reference");
  assert.match(result.diagnostics[0]!.reason, /Monster AI red_ai/);
});

test("unknown but correctly encoded AI instructions are preserved for runtime diagnostics", () => {
  const f = fixture(); f.assets.red_ai!.data = aiSource([["UnknownFutureAction", [123]], ["Exit"]]);
  const result = f.compile([77]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.encounters[0]!.enemies[0]!.ai.data, f.assets.red_ai!.data);
});

test("ordinary and counter ability references are resolved per party before shared dependency collection", () => {
  const f = fixture();
  f.assets.red_ai!.data = aiSource([["SyncAI"], ["Act", [10]], ["CounterAct", [12]], ["Exit"]]);
  const first = f.compile();
  assert.deepEqual(first.encounters[0]!.enemies[0]!.aiAbilityIds, [10, 12]);
  f.tables["ability.csv"] = f.tables["ability.csv"]!.filter((row) => row.id !== "12");
  f.tables["monster_party.csv"]![1]!.monster2 = "0";
  const missing = f.compile();
  assert.deepEqual(missing.encounters.map((e) => e.partyId), [91]);
  assert.equal(missing.diagnostics[0]!.partyId, 77);
  assert.deepEqual(missing.diagnostics[0]!.dependency, { table: "ability.csv", id: 12 });
});

test("empty parties and out-of-range member values never create a phantom combatant", () => {
  for (const mutate of [
    (row: Record<string, string>) => { row.monster2 = "0"; row.monster8 = "0"; },
    (row: Record<string, string>) => { row.monster2 = "-1"; },
    (row: Record<string, string>) => { row.monster2_x_position = "2147483648"; },
  ]) {
    const f = fixture(); mutate(f.tables["monster_party.csv"]![0]!);
    const result = f.compile();
    assert.deepEqual(result.encounters.map((e) => e.partyId), [91]);
    assert.equal(result.diagnostics[0]!.partyId, 77);
  }
});

test("missing resistance and flag groups remain isolated source dependencies", () => {
  const f = fixture(); f.tables["monster.csv"]![0]!.resistance_attribute = "400";
  f.tables["monster_party.csv"]![1]!.monster2 = "0";
  const result = f.compile();
  assert.deepEqual(result.encounters.map((e) => e.partyId), [91]);
  assert.match(result.diagnostics[0]!.reason, /attribute_group.csv/);
  const g = fixture(); g.tables["monster_party.csv"]![0]!.battle_flag_group_id = "400";
  const flags = g.compile();
  assert.deepEqual(flags.encounters.map((e) => e.partyId), [91]);
  assert.deepEqual(flags.diagnostics[0]!.dependency, { table: "battle_flag_group.csv", id: 400, field: "group_id" });
});

test("illegal or duplicate selection fails before any source lookup and cannot partially compile", () => {
  for (const ids of [[], [77, 77], [77, 0], [-1], [1.5], [NaN], [Infinity], [0x80000000]]) {
    const f = fixture();
    const reader = f.reader();
    reader.row = () => { throw new Error("Should not resolve before selection validation"); };
    assert.throws(() => compileBattleEncounterSources(reader, f.input(ids)), /encounter party selection/);
    assert.deepEqual(f.calls, []);
  }
});

test("missing or aliased requested rows cannot silently compile another encounter", () => {
  const f = fixture(), result = f.compile([77, 404]);
  assert.deepEqual(result.requestedPartyIds, [77, 404]);
  assert.deepEqual(result.encounters.map((e) => e.partyId), [77]);
  assert.deepEqual(result.diagnostics[0]!.dependency, { table: "monster_party.csv", id: 404 });
  assert.equal(result.diagnostics[0]!.source, null);
  const reader = f.reader(), row = reader.row;
  reader.row = (table, id) => row(table, table === "monster_party.csv" && Number(id) === 404 ? 77 : id);
  const alias = compileBattleEncounterSources(reader, f.input([404]));
  assert.deepEqual(alias.encounters, []);
  assert.match(alias.diagnostics[0]!.reason, /different identity/);
});

test("compiled data/provenance is detached while string object identities retain full precision", () => {
  const f = fixture(), before = structuredClone({ tables: f.tables, assets: f.assets, sources: f.sources });
  const result = f.compile(), entry = result.encounters[0]!;
  assert.equal(entry.source.objectId, "-9223372036854775808");
  assert.equal(entry.enemies[0]!.ai.source.objectId, "-9223372036854775808");
  entry.metadata.battleFlags[0]!.values.battle_flag_id = "999";
  entry.source.objectId = "1";
  entry.enemies[0]!.ai.source.assetPath = "changed";
  entry.script!.data = {};
  assert.deepEqual({ tables: f.tables, assets: f.assets, sources: f.sources }, before);
  assert.equal(result.encounters[1]!.metadata.battleFlags[0]!.values.battle_flag_id, "14");
});
