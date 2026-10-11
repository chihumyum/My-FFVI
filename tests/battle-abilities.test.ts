import assert from "node:assert/strict";
import test from "node:test";
import { projectBattleAbilities } from "../src/core/battle-abilities.js";
import { compileBattleAbilityCatalog } from "../src/compiler/battle-abilities.js";
import { battleTableIndex } from "../src/compiler/battle.js";
import { BattleGame } from "../src/core/battle.js";
import { battleAbilityFixture, sourceQualifiedBattleFixture } from "./fixtures/battle-abilities.js";

test("source commands use current skill levels and types, never raw ownership or a stale projection", () => {
  const f = battleAbilityFixture(), before = structuredClone(f);
  const project = () => projectBattleAbilities(f.catalog, f.member, f.context);
  assert.deepEqual(project().entries.find((c) => c.commandId === 7)!.abilityIds, [10, 12]);
  assert.deepEqual(f, before);
  f.member.abilities.owned.find((a) => a.abilityId === 11)!.skillLevel = 100;
  assert.deepEqual(project().entries.find((c) => c.commandId === 7)!.abilityIds, [10, 11, 12]);
  assert.deepEqual(f.member.abilities.byCommand[0]!.abilityIds, [10, 12]);
  assert.ok(project().abilityIds.includes(13), "direct attack is independent of OwnedAbilityList");
});

test("Magitek release uses condition row identity 53, not condition type 607", () => {
  const f = battleAbilityFixture();
  const project = (ids: number[] | null) => projectBattleAbilities(f.catalog, f.member, { ...f.context, conditionIds: ids });
  const magitek = (ids: number[] | null) => project(ids).entries.find((c) => c.commandId === 26)!;
  assert.equal(magitek([]).released, false);
  assert.equal(magitek([607]).released, false);
  assert.equal(magitek([53]).available, true);
  assert.deepEqual(magitek([53]).abilityIds, [20]);
  assert.equal(project([53]).entries.find((c) => c.commandId === 1)!.released, false);
  assert.equal(project([78]).entries.find((c) => c.commandId === 1)!.released, false);
  assert.equal(magitek(null).released, null);
  assert.equal(magitek(null).available, null);
  assert.match(magitek(null).blockers.join(), /Unknown battle condition/);
});

test("menu order sorts normal and type-2 menus, then appends the selected BattleType commands", () => {
  const f = battleAbilityFixture();
  const project = projectBattleAbilities(f.catalog, f.member, f.context);
  assert.deepEqual(project.entries.filter((c) => c.menu !== "none").map((c) => c.commandId), [1, 26, 7, 3, 2, 5, 30]);
  assert.equal(project.entries.find((c) => c.commandId === 30)!.released, true, "appended menu bypasses condition release");
  const other = projectBattleAbilities(f.catalog, f.member, { ...f.context, battleType: 1 });
  assert.deepEqual(other.entries.filter((c) => c.menu === "extra").map((c) => c.commandId), [2, 5, 4]);
});

test("BattleType append preserves source order even when its later command has a higher sort priority", () => {
  const f = battleAbilityFixture();
  f.catalog.commands.push({ ...f.catalog.commands.find((c) => c.id === 30)!, id: 91, contentId: 2091 });
  f.member.abilities.commandIds.splice(f.member.abilities.commandIds.indexOf(30), 0, 91);
  const result = projectBattleAbilities(f.catalog, f.member, f.context);
  assert.deepEqual(result.entries.filter((c) => c.menu === "extra").map((c) => c.commandId), [2, 5, 91, 30]);
});

test("source exclusions, forbidden conditions and unknown context remain distinct", () => {
  const f = battleAbilityFixture();
  const magic = (overrides: Partial<typeof f.context>) => projectBattleAbilities(f.catalog, f.member, { ...f.context, ...overrides }).entries.find((c) => c.commandId === 7)!;
  assert.equal(magic({ conditionIds: [306] }).available, false);
  assert.equal(magic({ invalidContentIds: [2007] }).available, false);
  assert.equal(magic({ invalidContentIds: null }).available, null);
  assert.match(magic({ invalidContentIds: null }).blockers.join(), /Unknown battle content exclusion/);
  assert.equal(projectBattleAbilities(f.catalog, f.member, { ...f.context, itemMenuAvailable: null }).entries.find((c) => c.commandId === 3)!.available, null);
});

test("FF6 magic menu can open with no learned spell; equipped esper and trance meter are separate gates", () => {
  const f = battleAbilityFixture();
  f.member.abilities.owned.forEach((a) => a.skillLevel = 0);
  f.member.abilities.byCommand = [];
  f.member.abilities.commandIds.push(8);
  const query = () => projectBattleAbilities(f.catalog, f.member, f.context);
  assert.deepEqual(query().entries.find((c) => c.commandId === 7)!.abilityIds, []);
  assert.equal(query().entries.find((c) => c.commandId === 7)!.available, true);
  assert.equal(query().entries.find((c) => c.commandId === 8)!.available, null);
  f.context.magicLearningValue = 7;
  assert.equal(query().entries.find((c) => c.commandId === 8)!.available, false);
  f.context.magicLearningValue = 8;
  assert.equal(query().entries.find((c) => c.commandId === 8)!.available, true);
  f.member.magicStoneId = 77;
  assert.match(query().entries.find((c) => c.commandId === 7)!.blockers.join(), /magic-stone/);
});

test("unknown command and specialized or replacement providers are retained with blockers", () => {
  const f = battleAbilityFixture();
  f.member.abilities.commandIds.push(999, 90);
  let result = projectBattleAbilities(f.catalog, f.member, f.context);
  assert.equal(result.entries.find((c) => c.commandId === 999)!.available, null);
  assert.match(result.entries.find((c) => c.commandId === 90)!.blockers.join(), /specialized/);
  f.member.abilities.equipment[0] = 77;
  result = projectBattleAbilities(f.catalog, f.member, f.context);
  assert.match(result.entries.find((c) => c.commandId === 1)!.blockers.join(), /replacement/);
  assert.match(projectBattleAbilities(f.catalog, f.member, { ...f.context, conditionIds: [501] }).blockers.join(), /manipulated/);
});

test("an unknown source menu type is retained visibly instead of being mistaken for an inactive extra menu", () => {
  const f = battleAbilityFixture();
  f.catalog.commands.find((c) => c.id === 7)!.type = 999;
  const entry = projectBattleAbilities(f.catalog, f.member, f.context).entries.find((c) => c.commandId === 7)!;
  assert.equal(entry.menu, "normal");
  assert.equal(entry.available, null);
  assert.match(entry.blockers.join(), /menu type/);
});

test("invalid identity, conditions and context are rejected without changing inputs", () => {
  const f = battleAbilityFixture(), before = structuredClone(f);
  assert.throws(() => projectBattleAbilities(f.catalog, { ...f.member, jobId: 99 }, f.context), /character\/job/);
  assert.throws(() => projectBattleAbilities(f.catalog, f.member, { ...f.context, conditionIds: [999] }), /condition identity/);
  assert.throws(() => projectBattleAbilities(f.catalog, f.member, { ...f.context, invalidContentIds: [2, 2] }), /exclusion/);
  assert.throws(() => projectBattleAbilities(f.catalog, f.member, { ...f.context, partySize: 0 }), /party-size/);
  assert.deepEqual(f, before);
});

test("range-12 command qualification uses the native party-count gate", () => {
  const f = battleAbilityFixture();
  f.catalog.abilities.find((a) => a.id === 13)!.range = 12;
  const query = (partySize: number | null) => projectBattleAbilities(f.catalog, f.member, { ...f.context, partySize }).entries.find((c) => c.commandId === 1)!;
  assert.equal(query(1).available, false);
  assert.equal(query(2).available, true);
  assert.equal(query(null).available, null);
});

test("source battle actions follow current learning and conditions instead of static lists", () => {
  const content = sourceQualifiedBattleFixture(), battle = new BattleGame(content, 31);
  assert.equal(battle.canUse("a", 10, 7), true);
  assert.equal(battle.canUse("a", 11, 7), false, "stale development list cannot grant unlearned healing");
  assert.equal(battle.canUse("a", 12, 7), false, "source ownership cannot grant an unsupported effect");
  assert.equal(battle.canUse("a", 13, 1), true, "direct attack need not be in static ability list");
  battle.players[0]!.ownedAbilities!.abilities.owned.find((a) => a.abilityId === 11)!.skillLevel = 100;
  assert.equal(battle.canUse("a", 11, 7), true);
  battle.players[0]!.conditionIds = [306];
  assert.equal(battle.canUse("a", 11, 7), false);
  assert.equal(battle.commandMenu("a").find((c) => c.id === 7)!.available, false);
  assert.equal(content.players[0]!.ownedAbilities!.abilities.owned.find((a) => a.abilityId === 11)!.skillLevel, 99);
});

test("unknown battle commands and missing effects are visible disabled entries", () => {
  const content = sourceQualifiedBattleFixture();
  content.players[0]!.ownedAbilities!.abilities.commandIds.push(999);
  const battle = new BattleGame(content, 31);
  assert.equal(battle.commandMenu("a").find((c) => c.id === 999)!.available, false);
  assert.ok(battle.commandMenu("a").find((c) => c.id === 999)!.blockers.length);
  delete content.abilities[10];
  assert.equal(battle.commandMenu("a").find((c) => c.id === 7)!.available, false);
});

test("unknown source entry context cannot fall through to a stale development action list", () => {
  const content = sourceQualifiedBattleFixture();
  content.qualificationContext!.conditionContext = "unknown";
  content.qualificationContext!.invalidContentIds = null;
  const battle = new BattleGame(content, 31);
  assert.equal(battle.canUse("a", 10, 7), false);
  assert.ok(battle.commandMenu("a").find((c) => c.id === 26), "unknown release preserves command");
  content.qualificationContext!.mode = "development-static";
  battle.players[0]!.commands = [100];
  assert.equal(battle.canUse("a", 11, 100), true, "explicit development profile remains compatible");
  assert.ok(battle.commandQualification("a")!.blockers.length, "source query still reports unknown context");
});

test("source mode refuses missing owned state and incomplete configuration", () => {
  const content = sourceQualifiedBattleFixture();
  delete content.players[0]!.ownedAbilities;
  assert.throws(() => new BattleGame(content, 31), /lacks owned/);
  delete content.qualificationContext;
  assert.throws(() => new BattleGame(content, 31), /Incomplete battle qualification/);
});

test("compiler retains source command metadata, provenance and unsupported providers", () => {
  const rows = (values: Record<string, string | number>[]) => values.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])));
  const tables = {
    "character_status.csv": rows([{ id: 13, job_id: 12, command_id1: 7, command_id2: 0, command_id3: 0, command_id4: 0, command_id5: 0, command_id6: 0 }]),
    "job.csv": rows([{ id: 12, change_command_1: 0, change_command_2: 0, change_command_3: 0, change_command_4: 0, change_command_5: 0 }]),
    "command.csv": rows([{ id: 7, mes_id_name: "SYNTHETIC", command_type: 1, list_type: 2, execution_type: 2, ability_group_id: 9, ability_id: 0, condition_group_id: 5, release_type: 0, release_value1: 0, release_value2: 0 }]),
    "sub_command.csv": [], "ability_group.csv": rows([{ id: 1, group_id: 9, type_id: 77 }]),
    "chanting.csv": rows([{ id: 77, ability_type_id: 1 }]),
    "condition_group.csv": rows([{ id: 1, group_id: 5, condition_id: 306 }]),
    "condition.csv": rows([{ id: 306, condition_type: 6 }]),
    "ability.csv": rows([{ id: 10, type_id: 1, ability_group_id: 20, battle_renge_id: 3, renge_id: 12 }]),
    "content.csv": rows([{ id: 2007, type_id: 7, type_value: 7 }]),
  };
  const sources = Object.fromEntries(Object.keys(tables).map((key) => [key, { file: "synthetic", serializedFile: "fixture", objectId: "9223372036854775807", assetPath: key }]));
  const compile = () => compileBattleAbilityCatalog(battleTableIndex(tables, sources), tables, [13]);
  const built = compile();
  assert.deepEqual(built.catalog.commands[0]!.abilityTypes, [1]);
  assert.deepEqual(built.catalog.commands[0]!.forbiddenConditionIds, [306]);
  assert.equal(built.catalog.commands[0]!.contentId, 2007);
  assert.equal(built.catalog.abilities[0]!.range, 12, "command gate reads RengeId, not effect BattleRengeId");
  assert.match(built.catalog.characters[0]!.blockers.join(), /Gogo/);
  assert.ok(built.sources.every((source) => source.objectId === "9223372036854775807"));
  tables["condition.csv"] = [];
  assert.throws(compile, /Unresolved table row condition.csv:306/);
});
