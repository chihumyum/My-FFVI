import test from "node:test";
import assert from "node:assert/strict";
import { compilePlayerBattleDefinitions, type PlayerBattleInput } from "../src/compiler/player-battle.js";
import { compileOwnedCharacterInitialization } from "../src/compiler/owned-character.js";
import { fixtureWeaponEffects } from "./fixtures/equipment.js";
import { ownedCharacterFixture } from "./fixtures/owned-character.js";

function fixture() {
  const f = ownedCharacterFixture();
  const character = f.tables["character_status.csv"]![0]!;
  Object.assign(character, { character_asset_id: "2", growth_curve_group_id: "1", corps: "1" });
  f.tables["character_asset.csv"] = [{ id: "2", asset_name: "bc_synthetic_owner" }];
  const key = "Assets/Synthetic/BC_SYNTHETIC_OWNER/Idle_00.png";
  const spriteSource = { file: "synthetic.bundle", assetPath: key,
    serializedFile: "synthetic", objectId: "-9223372036854775808" };
  const input = (): PlayerBattleInput => ({
    tables: f.tables,
    initializations: { 2: compileOwnedCharacterInitialization(f.reader(), f.tables, 2, (key) => key, fixtureWeaponEffects()).template },
    ordinaryWeaponEffects: fixtureWeaponEffects(),
    characterMedia: { 2: { characterId: 2, spriteGroup: "bc_synthetic_owner",
      source: f.reader().row("character_asset.csv", 2).source } },
    sprites: { [key]: { source: spriteSource, name: "Idle_00", file: `sprites/${"a".repeat(64)}.png`,
      sha256: "a".repeat(64), representation: "source-texture-full-rect", width: 32, height: 32, pivot: [0.5, 0] } },
    name: (key) => key,
  });
  return { ...f, input, key };
}
function compile(f = fixture(), input = f.input()) {
  return compilePlayerBattleDefinitions(f.reader(), input);
}

test("ordinary battle templates preserve source identity and confirmed stats without granting actions or ownership", () => {
  const f = fixture();
  f.tables["armor.csv"]!.find((r) => r.id === "7")!.max_hp_up = "50";
  const input = f.input(), before = JSON.stringify(input), result = compile(f, input);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.definitions.length, 1);
  const definition = result.definitions[0]!;
  assert.equal(definition.id, "player:2");
  assert.equal(definition.level, 2, "experience-derived initial level, not the source base level 90");
  assert.equal(definition.hp, 150, "template HP is confirmed maximum; owned current HP remains 100");
  assert.equal(input.initializations[2]!.initial.hp, 100);
  assert.deepEqual(definition.abilities, []);
  assert.deepEqual(definition.commands, []);
  assert.equal(definition.ownedAbilities, undefined);
  assert.deepEqual(definition.sprites, { idle: f.key, mount: null });
  assert.deepEqual(result.requiredContext, { qualification: "source", appearance: "ordinary", magitek: false });
  assert.equal(result.dependencies[0]!.media[0]!.source.objectId, "-9223372036854775808");
  assert.ok(result.dependencies[0]!.sources.some((s) => s.assetPath === "character_asset.csv"));
  definition.sprites.idle = "changed";
  definition.attackElements.push(8);
  result.dependencies[0]!.media[0]!.source.objectId = "1";
  assert.equal(JSON.stringify(input), before, "compiled values and dependencies are detached");
});

test("battle physical and elemental projection use the real weapon arm instead of fixed arm one", () => {
  const f = fixture(), character = f.tables["character_status.csv"]![0]!;
  character.content_id1 = "201";
  character.content_id2 = "101";
  const result = compile(f);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.definitions[0]!.physical!.attack, 50);
  assert.deepEqual(result.definitions[0]!.attackElements, [1]);
  assert.notDeepEqual(result.definitions[0]!.elementResistances, {});
});

test("a copied template cannot invent levels, skills, current HP or passive inputs", () => {
  const f = fixture();
  for (const mutate of [
    (t: PlayerBattleInput["initializations"][string]) => { t.initial.level++; },
    (t: PlayerBattleInput["initializations"][string]) => { t.initial.hp++; },
    (t: PlayerBattleInput["initializations"][string]) => { t.initial.abilities.owned[1]!.skillLevel = 100; },
    (t: PlayerBattleInput["initializations"][string]) => { t.parameterContext.parameters.passive.hp = 10; },
  ]) {
    const input = f.input(); mutate(input.initializations[2]!);
    const result = compile(f, input);
    assert.deepEqual(result.definitions, []);
    assert.match(result.blockers[0]!.reasons[0]!, /differs from source/);
  }
});

test("new unsupported source providers remain blockers instead of reusing an old successful template", () => {
  for (const [table, column, value, pattern] of [
    ["character_status.csv", "initial_condition_group", "7", /conditions/],
    ["job.csv", "change_command_1", "5", /job command replacement/],
    ["weapon.csv", "wear_function_group_id", "8", /wear_function_group/],
  ] as const) {
    const f = fixture(), input = f.input();
    (table === "weapon.csv" ? f.tables[table]!.find((r) => r.id === "7")! : f.tables[table]![0]!)[column] = value;
    const result = compile(f, input);
    assert.equal(result.definitions.length, 0);
    assert.match(result.blockers[0]!.reasons[0]!, pattern);
  }
});

test("missing and ambiguous exact idle media never fall back to riding or another character", () => {
  const f = fixture();
  const missing = f.input(), old = missing.sprites[f.key]!;
  delete missing.sprites[f.key];
  missing.sprites[f.key.replace("Idle_00", "RideL_00")] = old;
  assert.match(compile(f, missing).blockers[0]!.reasons[0]!, /exact ordinary battle pose/);
  const duplicate = f.input();
  duplicate.sprites[f.key.toLowerCase()] = structuredClone(duplicate.sprites[f.key]!);
  assert.match(compile(f, duplicate).blockers[0]!.reasons[0]!, /ambiguous/);
  const wrong = f.input();
  wrong.characterMedia[2]!.spriteGroup = "other_owner";
  assert.match(compile(f, wrong).blockers[0]!.reasons[0]!, /mismatched source character media/);
});

test("media provenance, original canvas and pivot must match the supported representation", () => {
  const f = fixture();
  for (const change of [
    (s: PlayerBattleInput["sprites"][string]) => { s.source.objectId = 9007199254740993 as unknown as string; },
    (s: PlayerBattleInput["sprites"][string]) => { s.source.assetPath = "different-source"; },
    (s: PlayerBattleInput["sprites"][string]) => { s.pivot = [0.5, 0.5]; },
    (s: PlayerBattleInput["sprites"][string]) => { s.representation = "atlas-crop"; },
    (s: PlayerBattleInput["sprites"][string]) => { s.file = "unbound.png"; },
  ]) {
    const input = f.input(); change(input.sprites[f.key]!);
    const result = compile(f, input);
    assert.equal(result.definitions.length, 0);
    assert.equal(result.blockers[0]!.stage, "media");
  }
});

test("explicit missing candidates are diagnosed without suppressing independent valid definitions", () => {
  const f = fixture(), input = f.input();
  input.sourceIds = [99, 2];
  const result = compile(f, input);
  assert.deepEqual(result.definitions.map((d) => d.sourceId), [2]);
  assert.deepEqual(result.blockers.map((b) => b.sourceId), [99]);
  assert.match(result.blockers[0]!.reasons[0]!, /Missing source owned initialization/);
  assert.deepEqual(result.dependencies.map((d) => d.sourceId), [2, 99]);
  input.sourceIds = [2, 2];
  assert.throws(() => compile(f, input), /duplicate player battle request/);
  delete input.sourceIds;
  input.initializations.duplicate = input.initializations[2]!;
  assert.throws(() => compile(f, input), /duplicate player battle initialization/);
});
