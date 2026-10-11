import test from "node:test";
import assert from "node:assert/strict";
import { GameState, type GameStateContent } from "../src/core/game-state.js";
import { compileOwnedCharacterInitialization } from "../src/compiler/owned-character.js";
import { ownedCharacterFixture } from "./fixtures/owned-character.js";
import { magitekRowId, ownedConditionGameFixture } from "./fixtures/owned-condition.js";
import { fixtureParty } from "./fixtures/party.js";
const add = { kind: "add-condition" as const, conditionType: 607, target: 0 };
const remove = { ...add, kind: "remove-condition" as const };

test("owned conditions commit once, survive restore and appear in the battle lease", () => {
  const { state, make } = ownedConditionGameFixture(), before = state.snapshot();
  const prepared = state.fieldOwnedConditions.prepare(add);
  assert.deepEqual(state.snapshot(), before);
  assert.deepEqual(prepared.steps[0]!.appearance.activeMembers.map((m) => m.conditionIds), [[magitekRowId], []]);
  prepared.commit();
  assert.throws(prepared.commit, /Stale/);
  const saved = state.snapshot(), restored = make();
  restored.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot(), saved);
  const pending = restored.fieldOwnedConditions.prepare(remove), lease = restored.openBattle(1000);
  assert.deepEqual(restored.battlePlayers(lease).map((p) => p.conditionIds), [[magitekRowId], [magitekRowId]]);
  assert.throws(pending.commit, /reserved/);
  assert.throws(() => restored.fieldOwnedConditions.prepare(add), /reserved/);
  restored.cancelBattle(lease);
  restored.fieldOwnedConditions.prepare(remove).commit();
  assert.deepEqual(restored.snapshot().roster.map((p) => p.conditionIds), [[], []]);
});

test("candidate conditions share inventory generation and publish only with their map draft", () => {
  const { state } = ownedConditionGameFixture(), before = state.snapshot();
  const discarded = state.prepareFieldState();
  discarded.ports.ownedConditions.prepare(add).commit();
  assert.deepEqual(state.snapshot(), before);
  const draft = state.prepareFieldState(), stale = draft.ports.ownedConditions.prepare(add);
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 7 }).commit();
  assert.throws(stale.commit, /Stale/);
  draft.ports.ownedConditions.prepare(add).commit();
  const late = draft.ports.ownedConditions.prepare(remove);
  assert.deepEqual(state.snapshot(), before);
  assert.equal(draft.commit(), true);
  assert.equal(draft.commit(), false);
  assert.equal(discarded.commit(), false);
  assert.equal(state.gil, before.gil + 7);
  assert.deepEqual(state.snapshot().roster.map((p) => p.conditionIds), [[magitekRowId], [magitekRowId]]);
  assert.throws(late.commit, /Stale/);
  draft.ports.ownedConditions.prepare(remove).commit();
  assert.deepEqual(state.snapshot().roster.map((p) => p.conditionIds), [[], []]);
});

test("disabled current members are still condition targets, while enabled outside owners are not target zero", () => {
  const { state } = ownedConditionGameFixture(), snapshot = state.snapshot();
  snapshot.roster[0]!.enabled = false;
  snapshot.party = fixtureParty(["a"]);
  state.restore(snapshot);
  state.fieldOwnedConditions.prepare(add).commit();
  assert.deepEqual(state.snapshot().roster.map((p) => p.conditionIds), [[magitekRowId], []]);
  state.fieldOwnedConditions.prepare({ ...add, target: -1 }).commit();
  assert.deepEqual(state.snapshot().roster.map((p) => p.conditionIds), [[magitekRowId], [magitekRowId]]);
  state.fieldOwnedConditions.prepare({ ...remove, target: 1 }).commit();
  assert.deepEqual(state.snapshot().roster.map((p) => p.conditionIds), [[], [magitekRowId]]);
});

test("Magitek has no foot damage, field clock or resource write, and unknown active statuses stay blocked", () => {
  const { state } = ownedConditionGameFixture();
  state.fieldOwnedConditions.prepare(add).commit();
  const before = state.snapshot();
  for (const transportationId of [101, 106]) {
    const step = state.fieldSteps.prepareStep(transportationId);
    assert.deepEqual(step.result.damage, []);
    assert.equal(step.result.soundId, null);
    step.commit();
    assert.deepEqual(state.snapshot(), before);
  }
  const corrupt = state.snapshot(); corrupt.roster[0]!.conditionIds = [123456];
  assert.throws(() => state.restore(corrupt), /Unknown battle condition/);
  const duplicate = state.snapshot(); duplicate.roster[0]!.conditionIds.push(magitekRowId);
  assert.throws(() => state.restore(duplicate), /Duplicate/);
  assert.deepEqual(state.snapshot(), before);
});

test("battle inventory qualification snapshots enabled whole-roster occupancy and only leased members", () => {
  const { state } = ownedConditionGameFixture(), saved = state.snapshot();
  saved.party = fixtureParty(["a"]); state.restore(saved);
  const lease = state.openBattle(1000), inventory = state.battleInventory(lease);
  const qualification = inventory.qualification!;
  assert.deepEqual(qualification.members, [{ id: "a", sourceId: 1, equipment: saved.roster[0]!.equipment }]);
  const outsideGear = saved.roster[1]!.equipment[0]!;
  assert.equal(qualification.equipmentStock.find((s) => s.id === outsideGear)!.equipped,
    saved.roster.flatMap((p) => p.equipment).filter((id) => id === outsideGear).length);
  qualification.members[0]!.equipment[0] = 99999;
  qualification.equipmentStock[0]!.count = 99999;
  assert.notDeepEqual(state.battleInventory(lease), inventory);
  assert.deepEqual(state.snapshot(), saved);
  state.cancelBattle(lease);
  const disabled = state.snapshot(); disabled.roster[1]!.enabled = false; state.restore(disabled);
  const next = state.openBattle(1000);
  assert.equal(state.battleInventory(next).qualification!.equipmentStock.find((s) => s.id === outsideGear)!.equipped,
    disabled.roster[0]!.equipment.filter((id) => id === outsideGear).length);
});

function sourceInitializationSetup() {
  const f = ownedCharacterFixture();
  const { template } = compileOwnedCharacterInitialization(f.reader(), f.tables, 2, (key) => key);
  const fixture = ownedConditionGameFixture(), conditions = fixture.catalog.common.conditions;
  const player = { ...fixture.catalog.common.players[0]!, ...template.confirmed, id: "initial", sourceId: 2,
    hp: template.initial.hp, mp: template.initial.mp, level: template.initial.level,
    exp: template.initial.exp, conditionIds: [magitekRowId] };
  const content: GameStateContent = { kind: "game-state-development-v1", limits: fixture.catalog.gameState.limits,
    initialGil: 0, initialParty: fixtureParty(["initial"]), characterInitializations: { initial: template },
    rosterLifecycle: { initial: { initial: { ownedId: 1, jobId: 12, additionalLevel: 2, magicStoneId: 0,
      ownedJobs: [{ id: 12, level: 1, proficiency: 0 }] } }, releasedJobIds: [12], jobIds: [1, 12] },
    items: {}, initialItems: [], equipment: { initial: [...template.initial.equipment] } };
  const make = () => new GameState(content, [player], "source-initialization-fixture", conditions);
  return { content, make };
}

test("explicit checkpoint seed is applied after source initialization and restore never reseeds it", () => {
  const { content, make } = sourceInitializationSetup();
  // Source AddFromMaster initial state wins over common battle player projection.
  assert.deepEqual(make().snapshot().roster[0]!.conditionIds, []);
  content.initialOwnedConditions = [{ id: "initial", conditionIds: [magitekRowId] }];
  const state = make();
  assert.deepEqual(state.snapshot().roster[0]!.conditionIds, [magitekRowId]);
  state.fieldOwnedConditions.prepare(remove).commit();
  const saved = state.snapshot(), restored = make();
  restored.restore(saved);
  assert.deepEqual(restored.snapshot().roster[0]!.conditionIds, []);
  content.initialOwnedConditions = [{ id: "not-owned", conditionIds: [magitekRowId] }];
  assert.throws(make, /checkpoint identity/);
  content.initialOwnedConditions = [{ id: "initial", conditionIds: [magitekRowId] }, { id: "initial", conditionIds: [] }];
  assert.throws(make, /checkpoint identity/);
  content.initialOwnedConditions = [{ id: "initial", conditionIds: [123] }];
  assert.throws(make, /Unknown battle condition/);
});
