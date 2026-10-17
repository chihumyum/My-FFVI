import test from "node:test";
import assert from "node:assert/strict";
import {
  GameState, type GameStateSnapshot, type LegacyGameStateSnapshotV10,
  type BattleEscapeResult,
} from "../src/core/game-state.js";
import { BattleGame } from "../src/core/battle.js";
import { encounterContent } from "../src/core/battle-content.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";
import { itemFixture } from "./fixtures/items.js";

function fixture() {
  const { battle } = checkpointFixture();
  battle.gameState.initialItems = [{ id: 10, count: 3 }, { id: 20, count: 1 }];
  battle.gameState.items[20] = itemFixture(20, true);
  battle.common.conditions.rules.definitions.push({ id: 301, type: 1, overlapped: false, eraseGroupId: 3 });
  battle.common.conditions.behaviors.push({ id: 301, kind: "defend", name: "", untilType: 1 });
  const make = () => new GameState(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
  return { state: make(), make };
}
function result(state: GameState, lease: ReturnType<GameState["openBattle"]>): BattleEscapeResult {
  return { players: state.battlePlayers(lease), consumedItems: [] };
}
function legacy(snapshot: GameStateSnapshot): LegacyGameStateSnapshotV10 {
  assert.ok(snapshot.completedBattles.every((receipt) => receipt.outcome === "victory"));
  return { ...structuredClone(snapshot), formatVersion: 10,
    roster: snapshot.roster.map(({ magicLearningValue: _, ...member }) => structuredClone(member)),
    completedBattles: snapshot.completedBattles.map(({ serial, encounterId }) => ({ serial, encounterId })) };
}
function sourceFixture() {
  const f = characterLearningSessionFixture();
  const state = GameState.createNewGame(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions);
  return { ...f, state };
}

test("escape publishes spent items, resources, surviving conditions and rows once without a victory award", () => {
  const { state, make } = fixture(), before = state.snapshot(), lease = state.openBattle(1000);
  const escaped = result(state, lease);
  escaped.players[0]!.hp = 31; escaped.players[0]!.mp = 3; escaped.players[0]!.row = "back";
  escaped.players[1]!.hp = 0; escaped.players[1]!.conditionIds = [305];
  escaped.consumedItems = [{ id: 10, count: 1 }];
  const publish = state.prepareEscape(lease, escaped);
  const field = publish.fieldState();
  assert.deepEqual(field.puppetRoster.owned.map((member) => member.conditionTypes), [[], [5]]);
  assert.deepEqual(state.snapshot(), before, "preparation and candidate reads do not publish owned state");
  // Neither the caller's result nor a returned candidate may rewrite preparation.
  escaped.players[0]!.hp = 77; escaped.consumedItems[0]!.count = 3;
  field.puppetRoster.owned[1]!.conditionTypes.length = 0;
  publish.validate(); publish();
  const saved = state.snapshot();
  assert.equal(saved.formatVersion, 12);
  assert.equal(saved.roster[0]!.hp, 31); assert.equal(saved.roster[0]!.mp, 3);
  assert.equal(saved.roster[1]!.hp, 0); assert.deepEqual(saved.roster[1]!.conditionIds, [305]);
  assert.equal(state.activeParty[0]!.row, "back");
  assert.equal(saved.items.find((item) => item.id === 10)!.count, 2);
  for (const key of ["gil", "totalGil", "learnedAbilityIds", "characterNames", "equipmentStock", "nativeState"] as const)
    assert.deepEqual(saved[key], before[key]);
  for (const [index, member] of saved.roster.entries())
    for (const key of ["level", "exp", "maxHp", "maxMp", "growth", "abilities", "equipment"] as const)
      assert.deepEqual(member[key], before.roster[index]![key]);
  assert.deepEqual(saved.completedBattles, [{ serial: 0, encounterId: 1000, outcome: "escaped" }]);
  assert.deepEqual(state.completedEncounters, []);
  assert.equal(state.inBattle, false);
  assert.throws(publish, /Stale/); assert.throws(publish.validate, /Stale/); assert.throws(publish.fieldState, /Stale/);
  const restored = make(); restored.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot(), saved);
  const next = restored.openBattle(1001);
  assert.equal(next.serial, 1);
  restored.prepareVictory(next, { ...result(restored, next), gil: 14 })();
  assert.deepEqual(restored.completedEncounters, [1001]);
  assert.deepEqual(restored.snapshot().completedBattles, [
    { serial: 0, encounterId: 1000, outcome: "escaped" },
    { serial: 1, encounterId: 1001, outcome: "victory" },
  ]);
  assert.equal(restored.openBattle(1002).serial, 2);
});

test("a later invalid escape member cannot publish earlier consumption, row or damage", () => {
  const { state } = fixture(), before = state.snapshot(), lease = state.openBattle(1000);
  const escaped = result(state, lease);
  escaped.players[0]!.hp = 31; escaped.players[0]!.row = "back";
  escaped.players[1]!.mp = -1; escaped.consumedItems.push({ id: 10, count: 1 });
  assert.throws(() => state.prepareEscape(lease, escaped), /integer/);
  assert.deepEqual(state.snapshot(), before); assert.equal(state.inBattle, true);
  escaped.players[1]!.mp = 0;
  state.prepareEscape(lease, escaped)();
  assert.equal(state.snapshot().items.find((item) => item.id === 10)!.count, 2);
});

test("escaped results reject reward, drop, learning and experience payloads even when empty or zero", () => {
  const { state } = fixture(), before = state.snapshot(), lease = state.openBattle(1000);
  for (const extra of [{ gil: 0 }, { dropGrants: [] }, { observedAbilityIds: [] }, { awardedExperience: [] }]) {
    const forged = { ...result(state, lease), ...extra };
    assert.throws(() => state.prepareEscape(lease, forged), /Unknown or missing/);
    assert.deepEqual(state.snapshot(), before); assert.equal(state.inBattle, true);
  }
});

test("escape cannot change level, experience or resource maxima from the leased owner", () => {
  const { state } = fixture(), before = state.snapshot(), lease = state.openBattle(1000);
  for (const key of ["level", "exp", "maxHp", "maxMp"] as const) {
    const forged = result(state, lease); forged.players[1]![key]++;
    assert.throws(() => state.prepareEscape(lease, forged), /growth or resource maxima/);
    assert.deepEqual(state.snapshot(), before);
  }
});

test("escape checks the complete leased party and inventory identity", () => {
  const { state } = fixture(), before = state.snapshot(), lease = state.openBattle(1000);
  const changes: ((value: BattleEscapeResult) => void)[] = [
    (value) => { value.players.reverse(); },
    (value) => { value.players.pop(); },
    (value) => { value.players[1]!.sourceId++; },
    (value) => { value.players[1]!.side = "enemy"; },
    (value) => { value.players[1]!.row = "invalid" as "front"; },
    (value) => { value.consumedItems = [{ id: 10, count: 4 }]; },
    (value) => { value.consumedItems = [{ id: 20, count: 1 }]; },
    (value) => { value.consumedItems = [{ id: 999, count: 1 }]; },
    (value) => { value.consumedItems = [{ id: 10, count: 1 }, { id: 10, count: 1 }]; },
    (value) => { value.consumedItems = [{ id: 10, count: -1 }]; },
  ];
  for (const change of changes) {
    const forged = result(state, lease); change(forged);
    assert.throws(() => state.prepareEscape(lease, forged));
    assert.deepEqual(state.snapshot(), before); assert.equal(state.inBattle, true);
  }
  assert.throws(() => state.prepareEscape({ ...lease }, result(state, lease)), /Stale/);
});

test("battle-only conditions must already be removed and stable death state remains validated", () => {
  const { state } = fixture(), before = state.snapshot(), lease = state.openBattle(1000);
  const temporary = result(state, lease); temporary.players[0]!.conditionIds = [301];
  assert.throws(() => state.prepareEscape(lease, temporary), /uncleared battle-only/);
  const invalidDeath = result(state, lease); invalidDeath.players[1]!.hp = 0;
  assert.throws(() => state.prepareEscape(lease, invalidDeath), /condition|life|HP/i);
  assert.deepEqual(state.snapshot(), before); assert.equal(state.inBattle, true);
});

test("an obsolete escape preparation cannot close a newer lease with the same serial", () => {
  const { state } = fixture(), before = state.snapshot(), old = state.openBattle(1000);
  const escaped = result(state, old); escaped.consumedItems = [{ id: 10, count: 1 }];
  const publish = state.prepareEscape(old, escaped);
  state.cancelBattle(old);
  const next = state.openBattle(1000);
  assert.equal(next.serial, old.serial); assert.notEqual(next, old);
  assert.throws(publish.validate, /Stale/); assert.throws(publish, /Stale/);
  assert.deepEqual(state.snapshot(), before); assert.equal(state.inBattle, true);
  assert.deepEqual(state.battlePlayers(next), result(state, next).players);
});

test("source owners escape without running natural growth or observation learning", () => {
  const { state, battle: catalog } = sourceFixture(), before = state.snapshot(),
    lease = state.openBattle(1000, catalog.encounters[1000]!.rewardPolicy);
  const escaped = result(state, lease);
  escaped.players[0]!.hp--; escaped.players[0]!.mp--;
  const abilities = escaped.players[0]!.ownedAbilities!;
  const forged = structuredClone(escaped);
  forged.players[0]!.ownedAbilities!.abilities.owned.find((ability) => ability.abilityId === 142)!.skillLevel = 100;
  assert.throws(() => state.prepareEscape(lease, forged), /held abilities/);
  assert.deepEqual(state.snapshot(), before);
  state.prepareEscape(lease, escaped)();
  const saved = state.snapshot();
  assert.deepEqual(saved.roster[0]!.abilities, abilities.abilities);
  assert.deepEqual(saved.roster[0]!.growth, before.roster[0]!.growth);
  assert.deepEqual(saved.nativeState, before.nativeState);
  assert.deepEqual(saved.learnedAbilityIds, before.learnedAbilityIds);
  assert.deepEqual(state.completedEncounters, []);
  state.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(state.snapshot(), saved);
});

test("learning receipts cannot be relabeled as escaped battle results on restore", () => {
  const f = sourceFixture(), state = f.state, content = encounterContent(f.battle, 1000)!;
  const lease = state.openBattle(1000, content.rewardPolicy), battle = new BattleGame(content, 17, state.battlePlayers(lease),
    state.battleInventory(lease), state.battleProgression(lease, content.experience));
  for (let i = 0; i < 50; i++) battle.advance(10);
  assert.equal(battle.command(f.id, 10, "e1", 100), true);
  for (let i = 0; i < 200 && battle.phase === "active"; i++) battle.advance(10);
  assert.equal(battle.phase, "victory");
  state.prepareVictory(lease, battle.previewVictory()!)();
  const saved = state.snapshot();
  assert.deepEqual(saved.nativeState!.ownedMagic, [742]);
  assert.equal(saved.roster[0]!.growth!.observedLearning[0]!.battleSerial, 0);
  const forged = structuredClone(saved); forged.completedBattles[0]!.outcome = "escaped";
  assert.throws(() => state.restore(forged), /Unbound observed learning battle receipt/);
  assert.deepEqual(state.snapshot(), saved);
  // The historical format contained only victories, including valid learning.
  state.restore(legacy(saved));
  assert.deepEqual(state.snapshot(), saved);
});

test("strict version 10 migration creates detached victory receipts and version 12 round trips", () => {
  const { state, make } = fixture(), lease = state.openBattle(1000);
  state.prepareVictory(lease, { ...result(state, lease), gil: 14 })();
  const saved = state.snapshot(), old = legacy(saved), bytes = JSON.stringify(old);
  const restored = make(); restored.restore(old);
  assert.equal(JSON.stringify(old), bytes, "restore does not rewrite the caller's historical save");
  assert.deepEqual(restored.snapshot(), saved);
  assert.deepEqual(restored.completedEncounters, [1000]);
  old.completedBattles[0]!.encounterId = 999; old.roster[0]!.hp = 1;
  assert.deepEqual(restored.snapshot(), saved);
  restored.restore(JSON.parse(JSON.stringify(restored.snapshot())));
  assert.deepEqual(restored.snapshot(), saved);
  assert.equal(restored.openBattle(1001).serial, 1);
});

test("migration does not repair legacy shape, identities, unsupported versions or missing current outcomes", () => {
  const { state } = fixture(), lease = state.openBattle(1000);
  state.prepareVictory(lease, { ...result(state, lease), gil: 0 })();
  const saved = state.snapshot(), original = legacy(saved);
  const invalid = [
    { ...original, injected: true },
    { ...original, completedBattles: [{ ...original.completedBattles[0]!, outcome: "escaped" }] },
    { ...original, completedBattles: [{ serial: 2, encounterId: 1000 }] },
    { ...original, completedBattles: [{ serial: 0, encounterId: 0 }] },
    { ...original, catalogHash: "wrong" },
    { ...original, formatVersion: 9 },
    { ...saved, completedBattles: original.completedBattles },
    { ...saved, completedBattles: [{ ...saved.completedBattles[0]!, outcome: "unknown" }] },
  ];
  for (const value of invalid) {
    assert.throws(() => state.restore(value as GameStateSnapshot));
    assert.deepEqual(state.snapshot(), saved);
  }
  const missing = legacy(saved);
  delete (missing as Partial<LegacyGameStateSnapshotV10>).nativeState;
  assert.throws(() => state.restore(missing), /Unknown or missing/);
  assert.deepEqual(state.snapshot(), saved);
});
