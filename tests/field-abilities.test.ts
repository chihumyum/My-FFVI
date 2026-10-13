import test from "node:test";
import assert from "node:assert/strict";
import { fieldAbilityMenu, fieldAbilityTargets, projectFieldAbility, validateFieldAbilityCatalog,
  type FieldAbilityCatalog, type FieldAbilityCostOwner, type FieldAbilityMember } from "../src/core/field-abilities.js";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { fixture as battleFixture } from "./fixtures/battle-content.js";
import { abilityCostFixture } from "./fixtures/ability-cost.js";
import { fixtureParty } from "./fixtures/party.js";
import { equipmentOwnedAbilities } from "../src/core/equipment.js";

/** Independent authored menu program; no battle plan is copied into it. */
function catalog(): FieldAbilityCatalog {
  return {
    kind: "field-abilities-v1",
    rules: { kind: "field-ability-rules-v1", profile: "framework",
      random: { kind: "web-field-random-v1", seed: 314 } },
    commands: [{ id: 7, nameKey: "SYNTHETIC_MAGIC", type: 1, listType: 2,
      executionType: 2, abilityId: 0, contentId: null, abilityTypes: [1],
      releaseType: 0, releaseValues: [0, 0], forbiddenConditionIds: [], blockers: [] }],
    abilities: {
      91: { id: 91, contentId: 601, name: "Authored menu recovery", typeId: 1,
        menuFunctionGroupId: 900, menuRange: 6, cost: 4, power: 10,
        program: { groupId: 900, range: 6, process: { key: "None", values: [0, 0, 0] },
          forbiddenConditionIds: [], contentFlags: [1],
          functions: [{ slot: 1, functionId: 901, type: 1, series: 0, values: [2, 2, 0] }] },
        plan: { kind: "field-ability-plan-v1", modes: ["single", "all"],
          effects: [{ slot: 1, kind: "recovery", resource: "hp", calculation: "magic" }],
          magic: { accuracy: 100, contentFlags: [1], forceDefense: false, elements: [] } }, blockers: [] },
      92: { id: 92, contentId: null, name: "", typeId: 0,
        menuFunctionGroupId: 0, menuRange: 0, cost: 0, power: 0,
        program: { groupId: 0, range: 0, functions: [], process: { key: "None", values: [0, 0, 0] },
          forbiddenConditionIds: [], contentFlags: [] }, plan: null,
        blockers: ["Missing source content and no menu function group"] },
    },
  };
}

test("independent menu catalogs retain blocked missing content alongside supported metadata without granting it", () => {
  const value = catalog(), before = structuredClone(value);
  validateFieldAbilityCatalog(value, new BattleConditions(battleFixture().conditions));
  assert.deepEqual(value, before);
  value.abilities[92]!.typeId = -17; // Unknown raw scalar on a blocked row.
  validateFieldAbilityCatalog(value);
  assert.equal(value.abilities[92]!.plan, null);
});

test("catalog seed, profile and menu identity cannot silently select a different execution policy", () => {
  const changes: ((value: FieldAbilityCatalog) => void)[] = [
    value => { value.rules.random.seed = 0; },
    value => { value.rules.random.seed = 0x100000000; },
    value => { value.rules.random.kind = "unity-default" as never; },
    value => { value.rules.profile = "opening" as never; },
    value => { value.abilities[91]!.id = 93; },
    value => { value.abilities[91]!.program.groupId = 901; },
    value => { value.abilities[91]!.program.range = 1; },
  ];
  for (const change of changes) {
    const value = catalog(); change(value); const before = structuredClone(value);
    assert.throws(() => validateFieldAbilityCatalog(value)); assert.deepEqual(value, before);
  }
});

test("a battle-shaped plan, hidden blocked reason or partial menu program cannot certify a menu ability", () => {
  for (const failure of ["battle", "reason", "partial", "content", "blocked"] as const) {
    const value = catalog();
    if (failure === "battle") delete (value.abilities[91]!.plan as unknown as Record<string, unknown>).kind;
    if (failure === "reason") value.abilities[92]!.blockers = [];
    if (failure === "partial") value.abilities[91]!.program.functions.push({ slot: 2, functionId: 902, type: 23, series: 6, values: [0, 0, 0] });
    if (failure === "content") value.abilities[91]!.contentId = null;
    if (failure === "blocked") value.abilities[91]!.blockers = ["Unresolved function consumer"];
    assert.throws(() => validateFieldAbilityCatalog(value));
  }
});

test("condition dependencies and every late function are validated before a catalog is admitted", () => {
  const conditions = new BattleConditions(battleFixture().conditions), value = catalog();
  value.abilities[91]!.plan = { kind: "field-ability-plan-v1", modes: ["single"], magic: null,
    effects: [{ slot: 1, kind: "recover-condition", conditionIds: [99999] }] };
  value.abilities[91]!.menuRange = 1; value.abilities[91]!.program.range = 1;
  value.abilities[91]!.program.functions[0] = { slot: 1, functionId: 901, type: 12, series: 0, values: [910, 0, 0] };
  assert.throws(() => validateFieldAbilityCatalog(value, conditions), /Unknown battle condition/);
  value.abilities[91]!.plan!.effects = [{ slot: 1, kind: "recover-condition", conditionIds: [305] }];
  validateFieldAbilityCatalog(value, conditions);
  value.abilities[91]!.program.functions.push({ slot: 3, functionId: 902, type: 11, series: 0, values: [305, 0, 0] });
  value.abilities[91]!.plan!.effects.push({ slot: 2, kind: "recover-condition", conditionIds: [305] });
  assert.throws(() => validateFieldAbilityCatalog(value, conditions), /complete menu program/);
});

test("sparse and accessor catalogs never invoke caller code or repair their metadata", () => {
  const sparse = catalog(); delete sparse.commands[0];
  assert.throws(() => validateFieldAbilityCatalog(sparse), /array/);
  const value = catalog(); let reads = 0;
  Object.defineProperty(value.rules.random, "seed", { enumerable: true, get: () => { reads++; return 314; } });
  assert.throws(() => validateFieldAbilityCatalog(value), /data fields/); assert.equal(reads, 0);
  const symbols = catalog(); Object.defineProperty(symbols, Symbol("unbound"), { value: true });
  assert.throws(() => validateFieldAbilityCatalog(symbols), /data fields/);
});

function runtimeFixture() {
  const battle = battleFixture(), equipment = abilityCostFixture(), data = catalog();
  const loadout = { ...structuredClone(equipment.roster[0]!), id: "a" };
  const owned = {
    commandIds: [7], owned: [{ abilityId: 91, contentId: 601, skillLevel: 100 }],
    byCommand: [{ commandId: 7, abilityIds: [91] }], additionOrder: [601], sortOrder: [601],
    slots: Array.from({ length: 8 }, (_, index) => ({ level: index + 1, abilityIds: [null, null, null] })),
    skillLevelTargets: {}, learning: [], equipment: [],
  };
  const a: FieldAbilityMember = { ...structuredClone(battle.players[0]!), id: "a", sourceId: loadout.sourceId,
    hp: 20, mp: 10, maxHp: 100, maxMp: 20, enabled: true, abilities: owned };
  const b = { ...structuredClone(a), id: "b", sourceId: a.sourceId + 1 };
  const conditionCatalog = structuredClone(battle.conditions);
  conditionCatalog.rules.definitions.push({ id: 306, type: 6, overlapped: false, eraseGroupId: 3 });
  conditionCatalog.behaviors.push({ id: 306, kind: "silence", name: "Silence", untilType: 2 });
  const conditions = new BattleConditions(conditionCatalog);
  const costOwner: FieldAbilityCostOwner = { side: "player", catalog: equipment.catalog, loadout };
  return { data, roster: [a, b], party: fixtureParty(["a", "b"]), conditions, conditionCatalog,
    costOwner, context: { invalidContentIds: [] }, a, b };
}

test("field reads expose only held menu abilities, retain missing metadata, and do not require inactive parameter owners", () => {
  const f = runtimeFixture(); f.party.slots[1][0].id = "off-party";
  f.a.abilities!.owned.push({ abilityId: 92, contentId: 0, skillLevel: 100 },
    { abilityId: 93, contentId: 603, skillLevel: 100 });
  const before = structuredClone(f.roster);
  const rows = fieldAbilityMenu(f.data, f.roster, f.party, "a", f.costOwner, f.conditions, f.context);
  assert.deepEqual(rows.map(row => row.abilityId), [91, 93]);
  assert.equal(rows[0]!.available, true); assert.equal(rows[1]!.available, null);
  rows[0]!.cost!.contentIds.push(1000); rows[0]!.name = "Changed view";
  const targets = fieldAbilityTargets(f.data, f.roster, f.party, "a", 91, f.costOwner, f.conditions, f.context);
  targets[0]!.targetIds.push("off-party"); assert.deepEqual(f.roster, before);
  assert.equal(f.data.abilities[91]!.name, "Authored menu recovery");
  assert.deepEqual(fieldAbilityTargets(f.data, f.roster, f.party, "a", 91, f.costOwner, f.conditions, f.context)
    .at(-1)!.targetIds, ["a", "b"]);
});

test("single and all recovery use independent menu arithmetic with one payment and source targetSum", () => {
  const f = runtimeFixture(), before = structuredClone(f.roster); let draws = 0;
  const random = (minimum: number, maximum: number) => { assert.deepEqual([minimum, maximum], [0, 31]); draws++; return 0; };
  const single = projectFieldAbility(f.data, f.roster, f.party,
    { actorId: "a", abilityId: 91, selection: { kind: "single", id: "b" } }, f.costOwner, f.conditions, f.context, random)!;
  assert.equal(single.roster[1]!.hp, 66); assert.equal(single.roster[0]!.mp, 6); assert.equal(draws, 1);
  draws = 0;
  const all = projectFieldAbility(f.data, f.roster, f.party,
    { actorId: "a", abilityId: 91, selection: { kind: "all" } }, f.costOwner, f.conditions, f.context, random)!;
  assert.deepEqual(all.roster.map(member => member.hp), [43, 43]); assert.equal(all.roster[0]!.mp, 6);
  assert.deepEqual(all.changedTargetIds, ["a", "b"]); assert.equal(draws, 2); assert.deepEqual(f.roster, before);
});

test("full and fallen members remain in all scope but do not draw or receive ordinary recovery", () => {
  const f = runtimeFixture(); f.a.hp = 100;
  const fallen = { ...structuredClone(f.b), id: "c", sourceId: f.b.sourceId + 1, hp: 0, conditionIds: [305] };
  f.roster.push(fallen); f.party.slots[0][3].id = "c"; let draws = 0;
  const projected = projectFieldAbility(f.data, f.roster, f.party,
    { actorId: "a", abilityId: 91, selection: { kind: "all" } }, f.costOwner, f.conditions, f.context,
    () => { draws++; return 0; })!;
  assert.deepEqual(projected.targetIds, ["a", "b", "c"]); assert.deepEqual(projected.changedTargetIds, ["b"]);
  assert.deepEqual(projected.roster.map(member => member.hp), [100, 43, 0]); assert.equal(draws, 1);
  assert.equal(projected.roster[0]!.mp, 6); assert.deepEqual(fallen.conditionIds, [305]);
});

test("None keeps its deterministic native classification while full targets and refused inputs consume nothing", () => {
  const f = runtimeFixture(), definition = f.data.abilities[91]!;
  definition.program.contentFlags.push(3);
  definition.program.functions.push({ slot: 2, functionId: 902, type: 23, series: 0, values: [0, 0, 0] });
  definition.plan!.effects.push({ slot: 2, kind: "field-unique-none", resultType: 2 });
  let draws = 0;
  const random = () => { draws++; return 0; };
  const projected = projectFieldAbility(f.data, f.roster, f.party,
    { actorId: "a", abilityId: 91, selection: { kind: "single", id: "b" } }, f.costOwner, f.conditions, f.context, random)!;
  assert.deepEqual(projected.effects[0]!.effects[1], { slot: 2, resource: "none", resultType: 2, value: 0 });
  assert.equal(draws, 1); f.a.hp = 100; f.b.hp = 100; draws = 0;
  const before = structuredClone(f.roster);
  for (const selection of [{ kind: "all" }, { kind: "single", id: "unheld" }] as const)
    assert.equal(projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91, selection },
      f.costOwner, f.conditions, f.context, random), null);
  assert.equal(draws, 0); assert.deepEqual(f.roster, before);
});

test("self calculated MP recovery is applied before the one final payment", () => {
  const f = runtimeFixture(), definition = f.data.abilities[91]!; f.a.mp = 8;
  definition.menuRange = 5; definition.program.range = 5; definition.plan!.modes = ["single"];
  definition.program.functions[0]!.values[1] = 3;
  definition.plan!.effects = [{ slot: 1, kind: "recovery", resource: "mp", calculation: "magic" }];
  assert.deepEqual(fieldAbilityTargets(f.data, f.roster, f.party, "a", 91, f.costOwner, f.conditions, f.context)
    .map(choice => choice.targetIds), [["a"]]);
  const before = structuredClone(f.roster);
  assert.equal(projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91,
    selection: { kind: "single", id: "b" } }, f.costOwner, f.conditions, f.context, () => 0), null);
  const projected = projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91,
    selection: { kind: "single", id: "a" } }, f.costOwner, f.conditions, f.context, () => 0)!;
  assert.equal(projected.roster[0]!.mp, 16); assert.equal(projected.roster[1]!.mp, 10);
  assert.deepEqual(f.roster, before);
});

test("owned proficiency, first matching command and both condition lists govern qualification independently of caches", () => {
  const f = runtimeFixture(); f.a.conditionIds = [306];
  f.data.commands[0]!.forbiddenConditionIds = [306];
  f.data.commands.push({ ...structuredClone(f.data.commands[0]!), id: 8, forbiddenConditionIds: [] });
  f.a.abilities!.commandIds = [7, 8];
  assert.equal(projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91, selection: { kind: "all" } },
    f.costOwner, f.conditions, f.context, () => { throw new Error("must not draw"); }), null);
  f.a.abilities!.commandIds = [8, 7];
  assert.equal(fieldAbilityMenu(f.data, f.roster, f.party, "a", f.costOwner, f.conditions, f.context)[0]!.available, true);
  f.data.abilities[91]!.program.forbiddenConditionIds = [306];
  assert.equal(fieldAbilityMenu(f.data, f.roster, f.party, "a", f.costOwner, f.conditions, f.context)[0]!.available, false);
  f.data.abilities[91]!.program.forbiddenConditionIds = []; f.a.conditionIds = [];
  f.a.abilities!.owned[0]!.skillLevel = 99; f.a.abilities!.byCommand = [];
  assert.equal(projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91, selection: { kind: "all" } },
    f.costOwner, f.conditions, f.context, () => { throw new Error("must not draw"); }), null);
});

test("unknown field exclusions are explicit while a known excluded content never consumes MP or a draw", () => {
  const f = runtimeFixture(), input = { actorId: "a", abilityId: 91, selection: { kind: "all" } as const };
  const before = structuredClone(f.roster), noDraw = () => { throw new Error("must not draw"); };
  assert.equal(fieldAbilityMenu(f.data, f.roster, f.party, "a", f.costOwner, f.conditions,
    { invalidContentIds: null })[0]!.available, null);
  assert.throws(() => projectFieldAbility(f.data, f.roster, f.party, input, f.costOwner, f.conditions,
    { invalidContentIds: null }, noDraw), /Unknown.*exclusions/);
  assert.equal(projectFieldAbility(f.data, f.roster, f.party, input, f.costOwner, f.conditions,
    { invalidContentIds: [601] }, noDraw), null); assert.deepEqual(f.roster, before);
});

test("equipment MP modifiers use the actual passive copies and one cost for the whole group", () => {
  const f = runtimeFixture(); f.data.abilities[91]!.cost = 5;
  f.costOwner.loadout.equipment[4] = 701; f.costOwner.loadout.equipment[5] = 701;
  f.a.abilities!.owned.push(...equipmentOwnedAbilities(f.costOwner.catalog, f.costOwner.loadout));
  const projected = projectFieldAbility(f.data, f.roster, f.party,
    { actorId: "a", abilityId: 91, selection: { kind: "all" } }, f.costOwner, f.conditions, f.context, () => 0)!;
  assert.equal(projected.cost.modifier, "half"); assert.equal(projected.cost.mp, 3); assert.equal(projected.roster[0]!.mp, 7);
  f.a.abilities!.owned.pop();
  assert.throws(() => projectFieldAbility(f.data, f.roster, f.party,
    { actorId: "a", abilityId: 91, selection: { kind: "all" } }, f.costOwner, f.conditions, f.context,
    () => { throw new Error("must not draw"); }), /passive/);
});

test("field revival removes referenced death records then adds the source amount without the separate recovery-wrapper plus one", () => {
  const f = runtimeFixture(), definition = f.data.abilities[91]!;
  f.conditionCatalog.rules.definitions.push({ id: 100, type: 5, overlapped: false, eraseGroupId: 3 });
  const conditions = new BattleConditions(f.conditionCatalog);
  f.b.hp = 0; f.b.conditionIds = [305]; definition.plan!.magic = null;
  definition.program.functions = [
    { slot: 1, functionId: 910, type: 12, series: 0, values: [920, 0, 0] },
    { slot: 2, functionId: 911, type: 34, series: 0, values: [2, 4, 25] },
  ];
  definition.plan!.effects = [{ slot: 1, kind: "recover-condition", conditionIds: [305, 100] },
    { slot: 2, kind: "recover-max-hp", mode: "percent", value: 25 }];
  const projected = projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91,
    selection: { kind: "single", id: "b" } }, f.costOwner, conditions, f.context,
    () => { throw new Error("revival must not draw"); })!;
  assert.equal(projected.roster[1]!.hp, 25); assert.deepEqual(projected.roster[1]!.conditionIds, []);
  assert.equal(projected.roster[0]!.mp, 6); assert.deepEqual(f.b.conditionIds, [305]);
  f.b.conditionIds = [100];
  assert.throws(() => projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91,
    selection: { kind: "single", id: "b" } }, f.costOwner, conditions, f.context, () => 0), /Unimplemented active/);
});

test("condition-only field recovery preserves order and requires a present record before any payment", () => {
  const f = runtimeFixture(), definition = f.data.abilities[91]!;
  f.b.conditionIds = [306, 306]; definition.plan!.magic = null;
  definition.program.functions = [{ slot: 1, functionId: 910, type: 12, series: 0, values: [920, 0, 0] }];
  definition.plan!.effects = [{ slot: 1, kind: "recover-condition", conditionIds: [306] }];
  const projected = projectFieldAbility(f.data, f.roster, f.party,
    { actorId: "a", abilityId: 91, selection: { kind: "all" } }, f.costOwner, f.conditions, f.context,
    () => { throw new Error("condition recovery must not draw"); })!;
  assert.deepEqual(projected.roster[1]!.conditionIds, [306]); assert.deepEqual(f.b.conditionIds, [306, 306]);
  assert.equal(projected.roster[0]!.mp, 6);
  f.b.conditionIds = [];
  assert.equal(projectFieldAbility(f.data, f.roster, f.party,
    { actorId: "a", abilityId: 91, selection: { kind: "all" } }, f.costOwner, f.conditions, f.context, () => 0), null);
});

test("late target admission and invalid random results do not partially project any owner or payment", () => {
  const f = runtimeFixture(); f.b.magicDefense = 300; let draws = 0;
  const before = structuredClone(f.roster);
  assert.throws(() => projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91, selection: { kind: "all" } },
    f.costOwner, f.conditions, f.context, () => { draws++; return 0; }), /Magic arithmetic/);
  assert.equal(draws, 0); assert.deepEqual(f.roster, before);
  f.b.magicDefense = 30;
  const after = structuredClone(f.roster);
  assert.throws(() => projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91, selection: { kind: "all" } },
    f.costOwner, f.conditions, f.context, () => 99), /Invalid battle random/);
  assert.deepEqual(f.roster, after);
  const wrong = { ...f.costOwner, loadout: { ...f.costOwner.loadout, id: "another-owner" } };
  assert.throws(() => projectFieldAbility(f.data, f.roster, f.party, { actorId: "a", abilityId: 91, selection: { kind: "all" } },
    wrong, f.conditions, f.context, () => 0), /actual player owner/);
});
