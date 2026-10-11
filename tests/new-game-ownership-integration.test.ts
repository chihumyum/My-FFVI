import test from "node:test";
import assert from "node:assert/strict";
import { GameState, type GameStateContent } from "../src/core/game-state.js";
import { createNewGame } from "../src/core/new-game.js";
import { compileNewGame } from "../src/compiler/new-game.js";
import { compileCharacterGrowth } from "../src/compiler/character-growth.js";
import { initialCharacterGrowth } from "../src/core/character-growth.js";
import { EventState } from "../src/core/event-state.js";
import { newGameFixture } from "./fixtures/new-game.js";
import { characterGrowthFixture } from "./fixtures/character-growth.js";
import { fixture as battleFixture } from "./fixtures/battle-content.js";
import { fixtureWeaponEffects } from "./fixtures/equipment.js";
import { itemFixture } from "./fixtures/items.js";

const initialStock = [
  { id: 1, count: 5 },
  { id: 2, count: 5 },
  { id: 3, count: 6 },
  { id: 4, count: 6 },
  { id: 5, count: 7 },
  { id: 101, count: 3 },
  { id: 201, count: 1 },
];
const firstId = "player:2", joiningId = "player:3";
const unlock = { kind: "unlock" as const, sourceId: 3, refreshActors: false as const };

/** Synthetic source rows retain CreateItems' five empty copies and each
 * AddFromMaster slot's separate grant. The runtime also knows an unowned
 * character, without making that template an initial owned member. */
function setup() {
  const f = characterGrowthFixture(), seed = newGameFixture();
  for (const table of ["initialize_data.csv", "item.csv", "transportation.csv"])
    f.tables[table] = structuredClone(seed.tables[table]!);
  f.tables["content.csv"]!.push(structuredClone(seed.tables["content.csv"]!.find((r) => r.id === "701")!));
  f.tables["game_constant_int.csv"]!.push(structuredClone(seed.tables["game_constant_int.csv"]!.find((r) => r.key_name === "MAX_GIL")!));
  f.tables["initialize_data.csv"]!.push({ id: "20", key_name: "INIT_ITEM_2", value1: "101", value2: "2" });
  // Source initialization keeps current HP before wearing this +50% armor.
  f.tables["armor.csv"]!.find((r) => r.id === "7")!.max_hp_up = "50";
  const definition = compileNewGame(f.reader(), f.tables, (key) => key, fixtureWeaponEffects()).definition;
  const original = definition.characters[0]!.template;
  const growth = compileCharacterGrowth(f.reader(), f.tables, original).plan;
  const joining = structuredClone(original);
  joining.initial.sourceId = 3;
  joining.initial.name = "Synthetic later owner";
  joining.nameTag = "LATER_OWNER";
  joining.equipmentCharacter.sourceId = 3;
  const catalog = structuredClone(definition.equipment);
  catalog.characters[3] = structuredClone(joining.equipmentCharacter);
  const battle = battleFixture();
  battle.conditions.rules.definitions.push({ id: 53, type: 607, overlapped: false, eraseGroupId: 4 });
  battle.conditions.rules.eraseRules.push({ id: 4, groupId: 4, conditionId: 53, type: 2, eraseConditionId: 0 });
  battle.conditions.behaviors.push({ id: 53, kind: "magitek", name: "", untilType: 3 });
  const player = {
    ...battle.players[0]!, ...original.confirmed,
    id: firstId, sourceId: 2, name: original.initial.name,
    level: original.initial.level, exp: original.initial.exp,
    hp: original.initial.hp, mp: original.initial.mp,
    conditionIds: [53],
  };
  const content: GameStateContent = {
    kind: "game-state-development-v1",
    limits: { gil: 999, item: 99, hp: 9999, mp: 999, level: 5, exp: 400 },
    sourceNewGame: structuredClone(definition),
    initialGil: 100, initialParty: structuredClone(definition.party),
    initialOwnedConditions: [{ id: firstId, conditionIds: [53] }],
    characterInitializations: { [firstId]: structuredClone(original), [joiningId]: joining },
    characterGrowth: { [firstId]: growth, [joiningId]: { ...structuredClone(growth), sourceId: 3 } },
    rosterLifecycle: {
      initial: { [firstId]: { ownedId: 1, jobId: 12, additionalLevel: 2, magicStoneId: 0,
        ownedJobs: [{ id: 12, level: 1, proficiency: 0 }, { id: 1, level: 1, proficiency: 0 }] } },
      releasedJobIds: [1], jobIds: [1, 12], firstJoinLevelAdjustments: { 3: 0 },
    },
    items: { 701: itemFixture(701, true) }, initialItems: [{ id: 701, count: 2 }],
    equipment: { [firstId]: [...original.initial.equipment] },
    equipmentSystem: {
      catalog, initialStock: structuredClone(initialStock),
      contexts: { [firstId]: structuredClone(original.parameterContext), [joiningId]: structuredClone(joining.parameterContext) },
      limits: structuredClone(original.limits), growth: {},
    },
  };
  const make = (candidate = content) => GameState.createNewGame(candidate, [player], "synthetic-bound-new-game", battle.conditions);
  return { content, player, conditions: battle.conditions, definition, make };
}

test("fresh shared owner consumes its bound initializer without applying the development Magitek checkpoint", () => {
  const { content, player, conditions, definition, make } = setup();
  const before = structuredClone(content), plan = createNewGame(definition), state = make();
  const snapshot = state.snapshot();
  assert.equal(snapshot.formatVersion, 7);
  assert.deepEqual(snapshot.roster.map((r) => [r.id, r.sourceId, r.ownedId]), [[firstId, 2, 1]]);
  assert.deepEqual(snapshot.roster[0]!.conditionIds, []);
  assert.equal(snapshot.roster[0]!.hp, 100);
  assert.equal(snapshot.roster[0]!.maxHp, 150);
  assert.deepEqual(snapshot.roster[0]!.growth, initialCharacterGrowth());
  assert.deepEqual(snapshot.equipmentStock, initialStock);
  assert.deepEqual(snapshot.items, [{ id: 701, count: 2 }]);
  assert.equal(snapshot.gil, 100);
  assert.equal(snapshot.totalGil, 100);
  assert.deepEqual(snapshot.learnedAbilityIds, [220, 31, 229]);
  assert.deepEqual(snapshot.characterNames, { OWNER_TAG: "SYNTHETIC_OWNER" });
  assert.deepEqual(snapshot.completedBattles, []);
  assert.deepEqual(plan.battlePreferences, { mode: "wait", speedIndex: 2 });
  assert.equal(plan.stage, "after-data-create-before-field-load");
  assert.equal(plan.entry.entrySynchronized, false);
  assert.equal(plan.events.currentMapId, null);
  assert.ok(plan.publication.missingProviders.includes("source-new-game-field-host"));
  const development = new GameState(content, [player], "synthetic-bound-new-game", conditions);
  assert.deepEqual(development.snapshot().roster[0]!.conditionIds, [53]);
  assert.deepEqual(content, before);
});

test("fresh ownership includes explicit spare gear while equip and unequip only change registrations", () => {
  const state = setup().make(), before = state.snapshot();
  assert.equal(state.changeEquipment(firstId, 1, 1), true);
  assert.equal(state.snapshot().roster[0]!.equipment[0], 1);
  assert.deepEqual(state.snapshot().equipmentStock, before.equipmentStock);
  assert.equal(state.changeEquipment(firstId, 1, 101), true);
  assert.deepEqual(state.snapshot(), before);
});

test("fresh-created restore retains exhausted empty records and does not rerun CreateItems or checkpoint seeds", () => {
  const { make } = setup(), state = make(), saved = state.snapshot();
  saved.equipmentStock.find((r) => r.id === 3)!.count = 0; // Already worn empty remains valid.
  saved.equipmentStock.find((r) => r.id === 1)!.count = 0; // Not selectable for a new hand.
  saved.items[0]!.count = 0;
  saved.gil = 7;
  const restored = make();
  restored.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot(), saved);
  assert.throws(() => restored.changeEquipment(firstId, 1, 1), /No owned empty equipment/);
  assert.deepEqual(restored.snapshot(), saved);
  // An existing empty slot can remain unchanged even when Count is zero.
  assert.equal(restored.changeEquipment(firstId, 3, 3), false);
  assert.deepEqual(restored.snapshot(), saved);
  const unknown = createNewGame(setup().definition).events;
  unknown.scenario[77] = null;
  unknown.global[0] = 42;
  const events = new EventState(unknown);
  assert.throws(() => events.read({ category: "ScenarioFlag1", index: 77 }), /未知事件状态/);
  assert.equal(events.read({ category: "ScenarioVariable", index: 0 }), 42);
});

test("a new owner adds all six source slot Counts exactly once, including repeated empty accessories", () => {
  const state = setup().make(), before = state.snapshot();
  const pending = state.fieldRoster.prepare(unlock);
  assert.deepEqual(state.snapshot(), before);
  pending.commit();
  const after = state.snapshot();
  assert.deepEqual(after.equipmentStock, [
    { id: 1, count: 5 }, { id: 2, count: 5 }, { id: 3, count: 7 },
    { id: 4, count: 7 }, { id: 5, count: 9 }, { id: 101, count: 4 }, { id: 201, count: 2 },
  ]);
  assert.equal(after.roster[1]!.ownedId, 2);
  assert.equal(after.roster[1]!.enabled, true);
  assert.deepEqual(after.learnedAbilityIds, before.learnedAbilityIds);
  assert.equal(after.characterNames.LATER_OWNER, "Synthetic later owner");
  state.fieldRoster.prepare(unlock).commit();
  assert.deepEqual(state.snapshot(), after);
  assert.throws(pending.commit, /Stale/);
});

test("secede removes material ownership but excludes empty Counts, and source refit returns only material Counts", () => {
  const state = setup().make();
  state.fieldRoster.prepare(unlock).commit();
  const enabled = state.snapshot();
  state.fieldRoster.prepare({ kind: "secede", sourceId: 3, removeEquipment: true, refreshActors: true }).commit();
  const disabled = state.snapshot();
  assert.equal(disabled.roster[1]!.enabled, false);
  assert.deepEqual(disabled.roster[1]!.equipment, enabled.roster[1]!.equipment);
  assert.deepEqual(disabled.equipmentStock, [
    { id: 1, count: 5 }, { id: 2, count: 5 }, { id: 3, count: 7 },
    { id: 4, count: 7 }, { id: 5, count: 9 }, { id: 101, count: 3 }, { id: 201, count: 1 },
  ]);
  state.fieldRoster.prepare({ kind: "join", sourceId: 3, position: null, row: "front",
    refreshActors: false, recovery: false, refitEquipment: true }).commit();
  assert.deepEqual(state.snapshot().equipmentStock, enabled.equipmentStock);
  assert.equal(state.snapshot().roster[1]!.enabled, true);
});

test("remove-all chooses actual owned empty records and leaves all Counts unchanged", () => {
  const state = setup().make();
  state.fieldRoster.prepare(unlock).commit();
  const before = state.snapshot();
  state.fieldRoster.prepare({ kind: "secede", sourceId: 3, removeEquipment: false, refreshActors: true }).commit();
  assert.deepEqual(state.snapshot().roster[1]!.equipment, [1, 1, 3, 4, 5, 5]);
  assert.deepEqual(state.snapshot().equipmentStock, before.equipmentStock);
});

test("missing actual empty candidates and stale unpublished owner drafts cannot partially publish", () => {
  const state = setup().make();
  state.fieldRoster.prepare(unlock).commit();
  const exhausted = state.snapshot();
  for (const id of [1, 2]) exhausted.equipmentStock.find((r) => r.id === id)!.count = 0;
  state.restore(exhausted);
  assert.throws(() => state.fieldRoster.prepare({ kind: "secede", sourceId: 3, removeEquipment: false, refreshActors: true }));
  assert.deepEqual(state.snapshot(), exhausted);
  const fresh = setup().make(), before = fresh.snapshot(), draft = fresh.prepareFieldState();
  draft.ports.roster!.prepare(unlock).commit();
  assert.deepEqual(fresh.snapshot(), before);
  fresh.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  const changed = fresh.snapshot();
  assert.equal(draft.commit(), false);
  assert.deepEqual(fresh.snapshot(), changed);
  assert.equal(changed.roster.length, 1);
});

test("fresh admission rejects source and runtime ownership or parameter mismatches", () => {
  const cases: [string, (content: GameStateContent) => void][] = [
    ["missing binding", (c) => { delete c.sourceNewGame; }],
    ["different initial source", (c) => { c.sourceNewGame!.characters[0]!.id = "other"; }],
    ["different party row", (c) => { c.sourceNewGame!.party.slots[0][0]!.row = "front"; }],
    ["different released jobs", (c) => { c.sourceNewGame!.releasedJobIds.push(12); }],
    ["different source money", (c) => { c.sourceNewGame!.gil++; }],
    ["different source initial item count", (c) => { c.sourceNewGame!.inventory[0]!.count++; }],
    ["different initial stock", (c) => { c.equipmentSystem!.initialStock[0]!.count++; }],
    ["different runtime equipment", (c) => { c.equipmentSystem!.catalog.definitions[101]!.strength++; }],
    ["different runtime character", (c) => { c.equipmentSystem!.catalog.characters[2]!.dominantArm = 2; }],
    ["different runtime parameter context", (c) => { c.equipmentSystem!.contexts[firstId]!.parameters.base.magic++; }],
    ["different capacity", (c) => { c.limits.item--; }],
  ];
  for (const [name, mutate] of cases) {
    const { content, make } = setup(), stable = make(), before = stable.snapshot();
    mutate(content);
    assert.throws(() => make(content), name);
    assert.deepEqual(stable.snapshot(), before, name);
  }
});

test("invalid restore remains atomic and does not substitute bound fresh stock", () => {
  const state = setup().make(), before = state.snapshot();
  for (const mutate of [
    (s: typeof before) => { s.equipmentStock.find((r) => r.id === 5)!.count = 100; },
    (s: typeof before) => { s.equipmentStock.push({ id: 5, count: 1 }); },
    (s: typeof before) => { s.equipmentStock.find((r) => r.id === 201)!.count = 0; },
    (s: typeof before) => { s.roster[0]!.maxHp++; },
  ]) {
    const invalid = structuredClone(before);
    mutate(invalid);
    assert.throws(() => state.restore(invalid));
    assert.deepEqual(state.snapshot(), before);
  }
});
