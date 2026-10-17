import test from "node:test";
import assert from "node:assert/strict";
import { createNewGame } from "../src/core/new-game.js";
import { EventState } from "../src/core/event-state.js";
import {
  compileNewGame,
  compileNewGameRoute,
} from "../src/compiler/new-game.js";
import { newGameFixture } from "./fixtures/new-game.js";

const compile = (f = newGameFixture()) =>
  compileNewGame(f.reader(), f.tables, (key) => key, {
    kind: "ordinary-weapon-effects-v1",
    additionalAbilities: [],
  });

test("fresh source initialization clears every event bank then enables only its player transport", () => {
  const plan = createNewGame(compile().definition);
  assert.equal(plan.stage, "after-data-create-before-field-load");
  assert.equal(plan.publication.state, "blocked");
  assert.deepEqual(plan.publication.missingProviders, [
    "source-new-game-field-host",
  ]);
  assert.equal(plan.events.scenario.length, 1024);
  assert.equal(plan.events.treasure.length, 1024);
  assert.ok(plan.events.scenario.every((n) => n === 0));
  assert.deepEqual(
    plan.events.treasure.flatMap((n, i) => (n === 1 ? [i] : [])),
    [700],
  );
  for (const bank of [plan.events.global, plan.events.area, plan.events.map])
    assert.ok(bank.every((n) => n === 0));
  assert.equal(plan.events.script, null);
  assert.equal(plan.events.scriptLabels, null);
  assert.equal(plan.events.selected, 0);
  assert.equal(plan.events.itemSelected, 0);
  assert.equal(plan.events.currentMapId, null);
  assert.equal(plan.entry.entrySynchronized, false);
  assert.deepEqual(plan.battlePreferences, { mode: "wait", speedIndex: 2 });
});

test("source new-game route is independent from map initializer and development checkpoint state", () => {
  const f = newGameFixture(),
    definition = compile(f).definition,
    plan = createNewGame(definition);
  const route = compileNewGameRoute(f.reader(), definition, f.scripts).route;
  assert.deepEqual(
    [route.mapId, route.entrance, route.scriptId, route.mapInitializerScriptId],
    [901, 7, 22, 902],
  );
  assert.equal(route.source.objectId, "9223372036854775807");
  assert.deepEqual(plan.entry.transportation, { id: 1, type: 1, assetId: 0 });
  assert.deepEqual(plan.owned.roster[0]!.conditionIds, []);
  assert.deepEqual(plan.entry.savedPlayer, {
    x: 0,
    y: 0,
    layer: 10,
    direction: 4,
  });
  assert.equal(plan.entry.beastExchangeFlags.length, 400);
  assert.ok(plan.entry.beastExchangeFlags.every((n) => n === 0));
  assert.deepEqual(plan.nativeInitialization.parkedTransportationMapIds, {
    1: -1,
    9: -1,
  });
});

test("initialization returns detached complete candidates and preserves native HP before equipment", () => {
  const f = newGameFixture();
  f.tables["armor.csv"]!.find((r) => r.id === "7")!.max_hp_up = "50";
  const definition = compile(f).definition,
    before = structuredClone(definition),
    a = createNewGame(definition),
    b = createNewGame(definition);
  assert.deepEqual(a, b);
  assert.equal(a.owned.roster[0]!.hp, 100);
  assert.equal(a.owned.roster[0]!.maxHp, 150);
  assert.deepEqual(a.owned.party.slots[0][0], { id: "player:2", row: "back" });
  assert.deepEqual(a.owned.learnedAbilityIds, [220, 31, 229]);
  assert.equal(a.owned.roster[0]!.abilities.owned[1]!.skillLevel, 0);
  assert.deepEqual(a.owned.characterNames, { OWNER_TAG: "SYNTHETIC_OWNER" });
  a.events.scenario[0] = 1;
  a.owned.roster[0]!.equipment[0] = 999;
  a.entry.beastExchangeFlags[0] = 10;
  assert.deepEqual(definition, before);
  assert.deepEqual(createNewGame(definition), b);
});

test("native empty-slot Count includes both five seed copies and initial owner additions", () => {
  const definition = compile().definition, plan = createNewGame(definition);
  const empty = plan.owned.equipmentStock.filter((entry) => definition.equipment.definitions[entry.id]!.empty);
  assert.deepEqual(empty, [
    { id: 1, count: 5 },
    { id: 2, count: 5 },
    { id: 3, count: 6 },
    { id: 4, count: 6 },
    { id: 5, count: 7 },
  ]);
  assert.deepEqual(plan.owned.equipmentStock.filter((entry) => !definition.equipment.definitions[entry.id]!.empty), [
    { id: 101, count: 1 },
    { id: 201, count: 1 },
  ]);
  assert.equal(Object.hasOwn(plan.nativeInitialization, "emptyEquipmentStocks"), false);
});

test("initial item and equipment grants merge by shared ownership and respect source capacities", () => {
  const f = newGameFixture();
  f.tables["initialize_data.csv"]!.push(
    { id: "10", key_name: "INIT_ITEM_2", value1: "701", value2: "120" },
    { id: "11", key_name: "INIT_ITEM_3", value1: "101", value2: "2" },
  );
  f.tables["initialize_data.csv"]!.find(
    (r) => r.key_name === "INIT_GIL",
  )!.value1 = "1200";
  const plan = createNewGame(compile(f).definition);
  assert.deepEqual(plan.owned.items, [{ id: 701, count: 99 }]);
  assert.equal(plan.owned.equipmentStock.find((s) => s.id === 101)!.count, 3);
  assert.equal(plan.owned.gil, 999);
  assert.equal(plan.owned.totalGil, 1200);
  const before = structuredClone(plan);
  const saveEvents = structuredClone(plan.events);
  saveEvents.scenario[0] = null;
  saveEvents.global[1] = 7;
  const restoredEvents = new EventState(saveEvents);
  assert.throws(
    () => restoredEvents.read({ category: "ScenarioFlag1", index: 0 }),
    /未知事件状态/,
  );
  assert.equal(
    restoredEvents.read({ category: "ScenarioVariable", index: 1 }),
    7,
  );
  assert.deepEqual(
    plan,
    before,
    "restore must not invoke a zero-fill initializer",
  );
});

test("missing optional initial Gil means source zero, while missing start route remains an error", () => {
  const f = newGameFixture();
  f.tables["initialize_data.csv"] = f.tables["initialize_data.csv"]!.filter(
    (r) => r.key_name !== "INIT_GIL",
  );
  assert.equal(createNewGame(compile(f).definition).owned.gil, 0);
  f.tables["initialize_data.csv"] = f.tables["initialize_data.csv"]!.filter(
    (r) => r.key_name !== "INT_START_MAP_ID",
  );
  assert.throws(() => compile(f), /Missing|Ambiguous/);
});

test("configured empty-equipment grants merge with native seeds and each initial slot", () => {
  const f = newGameFixture();
  f.tables["initialize_data.csv"]!.push(
    { id: "10", key_name: "INIT_ITEM_2", value1: "1", value2: "2" },
    { id: "11", key_name: "INIT_ITEM_3", value1: "5", value2: "1" },
  );
  const plan = createNewGame(compile(f).definition);
  // Empty weapon 1 is not equipped; empty accessory 5 occupies both slots.
  assert.equal(plan.owned.equipmentStock.find((s) => s.id === 1)!.count, 7);
  assert.equal(plan.owned.equipmentStock.find((s) => s.id === 5)!.count, 8);
  assert.deepEqual(plan.owned.items, [{ id: 701, count: 2 }]);
});

test("creation order differs from Corps positions when source initialization has an empty position", () => {
  const f = newGameFixture();
  f.tables["initialize_data.csv"]!.find(
    (r) => r.key_name === "INIT_PARTY_1",
  )!.key_name = "INIT_PARTY_3";
  const plan = createNewGame(compile(f).definition);
  assert.equal(plan.owned.roster[0]!.ownedId, 1);
  assert.equal(plan.owned.party.slots[0][0]!.id, null);
  assert.equal(plan.owned.party.slots[0][2]!.id, "player:2");
});

test("unsupported initial conditions, fifth owner and independent content owners cannot become defaults", () => {
  const f = newGameFixture();
  f.tables["character_status.csv"]![0]!.initial_condition_group = "7";
  assert.throws(() => compile(f), /conditions/);
  f.tables["character_status.csv"]![0]!.initial_condition_group = "0";
  f.tables["initialize_data.csv"]!.push({
    id: "10",
    key_name: "INIT_PARTY_5",
    value1: "14",
    value2: "0",
  });
  assert.throws(() => compile(f), /Fifth/);
  f.tables["initialize_data.csv"]!.pop();
  f.tables["initialize_data.csv"]!.find(
    (r) => r.key_name === "INIT_ITEM_1",
  )!.value1 = "601";
  assert.throws(() => compile(f), /content owner/);
});

test("duplicate source settings, owners, releases and transport identity reject before publication", () => {
  const f = newGameFixture();
  f.tables["initialize_data.csv"]!.push({
    ...f.tables["initialize_data.csv"]![0]!,
    id: "99",
  });
  assert.throws(() => compile(f), /ambiguous/);
  f.tables["initialize_data.csv"]!.pop();
  f.tables["initialize_data.csv"]!.push({
    id: "99",
    key_name: "INIT_PARTY_2",
    value1: "2",
    value2: "0",
  });
  assert.throws(() => compile(f), /Ambiguous/);
  f.tables["initialize_data.csv"]!.pop();
  f.tables["transportation.csv"]![1]!.type_id = "1";
  assert.throws(() => compile(f), /Ambiguous/);
});

test("forged checkpoint fields and omitted native empty inventory cannot enter new-game definitions", () => {
  const definition = compile().definition;
  assert.throws(
    () =>
      createNewGame({
        ...definition,
        initialOwnedConditions: [],
      } as typeof definition),
    /checkpoint fields/,
  );
  const missing = structuredClone(definition);
  missing.emptyEquipmentGrants.pop();
  assert.throws(() => createNewGame(missing), /Missing native empty/);
  const party = structuredClone(definition);
  party.party.slots[0][0]!.id = "player:unowned";
  assert.throws(() => createNewGame(party), /Unknown|owned|roster/);
  const seed = structuredClone(definition);
  seed.characters[0]!.template.initial.conditionIds = [53];
  assert.throws(() => createNewGame(seed), /initial owned character state/);
});

test("new-game route requires exact map/script binding and lossless source identity", () => {
  const f = newGameFixture(),
    definition = compile(f).definition;
  assert.throws(
    () => compileNewGameRoute(f.reader(), definition, []),
    /Missing/,
  );
  assert.throws(
    () =>
      compileNewGameRoute(f.reader(), definition, [...f.scripts, ...f.scripts]),
    /ambiguous/,
  );
  f.scripts[0]!.data.Name = "other";
  assert.throws(
    () => compileNewGameRoute(f.reader(), definition, f.scripts),
    /provenance/,
  );
});
