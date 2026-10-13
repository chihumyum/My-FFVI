import test from "node:test";
import assert from "node:assert/strict";
import { assembleGameCatalog, type GameCatalogModules } from "../src/compiler/game-catalog.js";
import { compileGameState, compileGameStateCatalog, type GameStateSource } from "../src/compiler/game-state.js";
import { compileNewGame } from "../src/compiler/new-game.js";
import { createNewGame } from "../src/core/new-game.js";
import { GameState } from "../src/core/game-state.js";
import { assertSourceGameCatalog } from "../src/core/source-catalog.js";
import { hash, canonical } from "../src/compiler/content.js";
import { newGameFixture } from "./fixtures/new-game.js";
import { fixtureWeaponEffects } from "./fixtures/equipment.js";
import { fixture as battleFixture } from "./fixtures/battle-content.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";

/** Synthetic tables and compiled modules, never an original story checkpoint.
 * Both entry composers reuse these definitions without minting extra owners. */
function catalogFixture() {
  const f = newGameFixture();
  for (const row of [{ id: "500", key_name: "MAX_EXP", value1: "15000000" },
    { id: "501", key_name: "MAX_LV", value1: "99" }])
    if (!f.tables["game_constant_int.csv"]!.some(existing => existing.key_name === row.key_name))
      f.tables["game_constant_int.csv"]!.push(row);
  Object.assign(f.tables["item.csv"]![0]!, { type_id: "2", condition_group_id: "0",
    attribute_id: "0", period_id: "0", throw_flag: "0", preparation_flag: "0", drink_flag: "0", machine_flag: "0",
    system_id: "1", invalid_reflection: "1", accuracy_rate: "100", destroy_rate: "100", standard_value: "0",
    menu_function_group_id: "0", battle_function_group_id: "0", menu_renge_id: "7", battle_renge_id: "7" });
  const reader = f.reader(), tables: GameStateSource["tables"] = Object.fromEntries(
    Object.entries(f.tables).map(([table, rows]) => [table,
      Object.fromEntries(rows.map(row => [row.id!, reader.row(table, row.id!)]))]),
  );
  const definition = compileNewGame(reader, f.tables, key => key, fixtureWeaponEffects()).definition;
  const fresh = createNewGame(definition), member = fresh.owned.roster[0]!, template = definition.characters[0]!.template;
  const battle = battleFixture();
  battle.conditions.rules.definitions.push({ id: 9007, type: 607, overlapped: false, eraseGroupId: 4 });
  battle.conditions.rules.eraseRules.push({ id: 4, groupId: 4, conditionId: 9007, type: 2, eraseConditionId: 0 });
  battle.conditions.behaviors.push({ id: 9007, kind: "magitek", name: "", untilType: 3 });
  const player = { ...battle.players[0]!, ...template.confirmed,
    id: member.id, sourceId: member.sourceId, name: member.name, level: member.level, exp: member.exp,
    hp: member.hp, mp: member.mp, conditionIds: [...member.conditionIds] };
  const future = { ...structuredClone(player), id: "player:14", sourceId: 14, name: "Potential owner" };
  const { players: _players, enemies: _enemies, encounterId: _encounter, formation: _formation,
    background: _background, contentHash: _hash, limitations: _limitations, drops: _drops, ...common } = battle;
  const runtime = encounterRuntimeFixture(), { development: _development, ...runtimeInput } = runtime.input;
  const modules: GameCatalogModules = {
    common, tables, name: key => key, ordinaryDefinitions: [player, future],
    reader: runtime.reader(), runtimeInput,
    owned: {
      characterInitializations: { [member.id]: structuredClone(template) },
      battleDefinitions: [structuredClone(player), structuredClone(future)], sourceNewGame: definition,
      equipmentSystem: { catalog: structuredClone(definition.equipment), initialStock: structuredClone(fresh.owned.equipmentStock),
        contexts: { [member.id]: structuredClone(template.parameterContext) }, limits: structuredClone(template.limits), growth: {} },
    },
  };
  return { f, tables, modules, definition, fresh, player, future };
}

test("source composition uses only new-game owners and initial conditions, independent of development seeds", () => {
  const f = catalogFixture();
  f.modules.ordinaryDefinitions[0]!.conditionIds = [9007];
  const source = assembleGameCatalog(f.modules, { kind: "source-new-game", limitations: [] });
  assertSourceGameCatalog(source);
  assert.equal(Object.hasOwn(source.gameState, "initialOwnedConditions"), false);
  assert.deepEqual(source.common.players.map(({ id, sourceId, hp, mp, conditionIds }) => ({ id, sourceId, hp, mp, conditionIds })),
    f.fresh.owned.roster.map(({ id, sourceId, hp, mp, conditionIds }) => ({ id, sourceId, hp, mp, conditionIds })));
  assert.equal(source.gameState.battleDefinitions!.length, 2, "Potential definitions remain reusable content");
  const state = GameState.createNewGame(source.gameState, source.common.players, source.contentHash, source.common.conditions);
  assert.deepEqual(state.snapshot().roster.map(({ id, enabled, conditionIds }) => ({ id, enabled, conditionIds })),
    [{ id: f.player.id, enabled: true, conditionIds: [] }]);
  assert.ok(!state.snapshot().roster.some(member => member.id === f.future.id));
});

test("source composition and GameState bind party, grants, equipment and durable resources to the initializer", () => {
  const f = catalogFixture(), catalog = assembleGameCatalog(f.modules, { kind: "source-new-game", limitations: [] });
  assert.deepEqual(catalog.gameState.initialParty, f.fresh.owned.party);
  assert.equal(catalog.gameState.initialGil, f.fresh.owned.gil);
  assert.deepEqual(catalog.gameState.initialItems, f.fresh.owned.items);
  assert.deepEqual(catalog.gameState.equipment[f.player.id], f.fresh.owned.roster[0]!.equipment);
  assert.deepEqual(catalog.gameState.equipmentSystem!.initialStock, f.fresh.owned.equipmentStock);
  const state = GameState.createNewGame(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
  const saved = state.snapshot();
  const restored = GameState.createNewGame(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
  restored.restore(saved); assert.deepEqual(restored.snapshot(), saved);
  const changed = structuredClone(saved); changed.catalogHash = "different-catalog";
  assert.throws(() => restored.restore(changed), /source\/version mismatch/);
  assert.deepEqual(restored.snapshot(), saved);
});

test("the explicit development composer retains its separate condition seed and source-new-game definition", () => {
  const f = catalogFixture(), checkpoint = { ...structuredClone(f.player), conditionIds: [9007] };
  const development = assembleGameCatalog(f.modules, { kind: "development-checkpoint", players: [checkpoint],
    limitations: ["Explicit synthetic checkpoint"], development: { scripts: [], flagGroups: [] } });
  assert.deepEqual(development.gameState.initialOwnedConditions, [{ id: checkpoint.id, conditionIds: [9007] }]);
  const state = new GameState(development.gameState, development.common.players, development.contentHash, development.common.conditions);
  assert.deepEqual(state.snapshot().roster[0]!.conditionIds, [9007]);
  assert.equal(state.nativeState, null);
  const fresh = GameState.createNewGame(development.gameState, development.common.players, development.contentHash, development.common.conditions);
  assert.deepEqual(fresh.snapshot().roster[0]!.conditionIds, []);
  const saved = state.snapshot();
  const restored = new GameState(development.gameState, development.common.players, development.contentHash, development.common.conditions);
  restored.restore(saved); assert.deepEqual(restored.snapshot(), saved);
});

test("source admission preserves every requested dependency while blocking development omissions", () => {
  const f = catalogFixture();
  f.modules.runtimeInput.encounters[0]!.metadata.appearanceProduction = 1;
  f.modules.runtimeInput.encounters[0]!.metadata.bgmId = 37;
  const source = assembleGameCatalog(f.modules, { kind: "source-new-game", limitations: [] });
  const development = assembleGameCatalog(f.modules, { kind: "development-checkpoint", players: [f.player],
    limitations: [], development: { scripts: [], flagGroups: [] } });
  assertSourceGameCatalog(source);
  assert.throws(() => assertSourceGameCatalog(development), /development owned-condition seed/);
  assert.deepEqual(source.encounterReport!.entries.map(entry => entry.partyId), f.modules.runtimeInput.requestedPartyIds);
  assert.equal(source.encounterReport!.requested, 2); assert.equal(source.encounterReport!.compiledDefinitions, 0);
  assert.equal(source.encounterReport!.blocked, 2); assert.equal(source.encounterReport!.withDevelopmentOmissions, 0);
  assert.deepEqual(source.encounters, {}); assert.deepEqual(source.common.drops!.monsters, []);
  const omissions = development.encounterDiagnostics!.filter(diagnostic => diagnostic.kind === "development-omission");
  assert.ok(omissions.some(diagnostic => diagnostic.code === "escape"));
  assert.ok(omissions.some(diagnostic => diagnostic.code === "appearance-production"));
  assert.ok(omissions.some(diagnostic => diagnostic.code === "battle-bgm" && diagnostic.dependency?.id === 37));
  for (const omission of omissions) assert.ok(source.encounterDiagnostics!.some(diagnostic =>
    diagnostic.kind === "blocked" && diagnostic.partyId === omission.partyId && diagnostic.code === omission.code &&
    diagnostic.reason.endsWith(omission.reason) && canonical(diagnostic.source) === canonical(omission.source) &&
    canonical(diagnostic.dependency ?? null) === canonical(omission.dependency ?? null)));
  assert.ok(!source.encounterDiagnostics!.some(diagnostic => diagnostic.kind === "development-omission"));
  assert.equal(development.encounterReport!.compiledDefinitions, 2);
});

test("explicit entry identities eliminate the initialParty shape without changing the legacy default seed", () => {
  const f = catalogFixture(), legacySource = { tables: f.tables, initialParty: [{ characterId: f.player.sourceId }] };
  const legacy = compileGameState(legacySource, key => key);
  const explicit = compileGameState({ tables: f.tables }, key => key,
    { owners: [{ id: f.player.id, sourceId: f.player.sourceId }] });
  assert.equal(canonical(explicit), canonical(legacy));
  assert.throws(() => compileGameState({ tables: f.tables }, key => key), /entry owners/);
  assert.throws(() => compileGameState({ tables: f.tables }, key => key,
    { owners: [{ id: f.player.id, sourceId: f.future.sourceId }], sourceNewGame: f.definition }), /owners differ/);
  assert.throws(() => compileGameState({ tables: f.tables }, key => key,
    { owners: [{ id: f.player.id, sourceId: f.player.sourceId }, { id: f.player.id, sourceId: f.player.sourceId }] }), /ambiguous/);
});

test("source initial equipment grants stay in their equipment owner, independently of item catalog data", () => {
  const f = catalogFixture();
  f.f.tables["initialize_data.csv"]!.push({ id: "90", key_name: "INIT_ITEM_2", value1: "101", value2: "2" });
  const definition = compileNewGame(f.f.reader(), f.f.tables, key => key, fixtureWeaponEffects()).definition;
  const fresh = createNewGame(definition), raw = f.f.reader();
  const tables = Object.fromEntries(Object.entries(f.f.tables).map(([table, rows]) => [table,
    Object.fromEntries(rows.map(row => [row.id!, raw.row(table, row.id!)]))]));
  const entry = compileGameState({ tables }, key => key,
    { owners: fresh.owned.roster.map(({ id, sourceId }) => ({ id, sourceId })), sourceNewGame: definition });
  assert.deepEqual(entry.initialItems, fresh.owned.items);
  assert.ok(!entry.initialItems.some(item => item.id === 101));
  assert.ok(fresh.owned.equipmentStock.some(item => item.id === 101));
  assert.equal(Object.hasOwn(entry, "initialOwnedConditions"), false);
  const data = compileGameStateCatalog({ tables }, key => key);
  assert.ok(data.items[701]); assert.equal(Object.hasOwn(data, "initialParty"), false);
  assert.equal(Object.hasOwn(data, "initialItems"), false);
});

test("missing ordinary initial templates block composition instead of creating or substituting owners", () => {
  const f = catalogFixture(); f.modules.ordinaryDefinitions = [f.future];
  assert.throws(() => assembleGameCatalog(f.modules, { kind: "source-new-game", limitations: [] }), /ordinary battle template/);
});

test("composed catalog bytes/hash are stable and detached across source and checkpoint consumers", () => {
  const f = catalogFixture(), first = assembleGameCatalog(f.modules, { kind: "source-new-game", limitations: [] });
  const second = assembleGameCatalog(f.modules, { kind: "source-new-game", limitations: [] });
  assert.equal(canonical(first), canonical(second));
  const { contentHash, ...payload } = first; assert.equal(contentHash, hash(payload));
  first.common.players[0]!.conditionIds.push(9007);
  first.gameState.equipment[f.player.id]![0] = 0;
  first.common.conditions.rules.definitions[0]!.type = 999;
  assert.equal(canonical(second), canonical(assembleGameCatalog(f.modules, { kind: "source-new-game", limitations: [] })));
  assert.deepEqual(f.modules.ordinaryDefinitions[0]!.conditionIds, []);
});
