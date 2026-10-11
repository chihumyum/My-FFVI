import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../src/core/game-state.js";
import { BattleGame } from "../src/core/battle.js";
import { encounterContent } from "../src/core/battle-content.js";
import { ordinaryWeaponGameFixture } from "./fixtures/ordinary-weapon.js";

function setup() {
  const { catalog } = ordinaryWeaponGameFixture();
  const state = new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
  state.fieldInventory.prepare({ kind: "grant-equipment", id: 162, count: 1 }).commit();
  state.changeEquipment("a", 1, 162);
  const content = encounterContent(catalog, Number(Object.keys(catalog.encounters)[0]));
  assert.ok(content);
  return { catalog, content, state };
}

test("owned ranged equipment crosses grants, opposite-hand changes, JSON restore and an immutable battle lease", () => {
  const { catalog, content, state } = setup();
  const totals = state.snapshot().equipmentStock;
  state.changeEquipment("a", 1, 1);
  state.changeEquipment("a", 2, 162);
  assert.deepEqual(state.snapshot().roster[0]!.equipment.slice(0, 2), [1, 162]);
  assert.deepEqual(state.snapshot().equipmentStock, totals);
  const saved = JSON.parse(JSON.stringify(state.snapshot()));
  const restored = new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, content.conditions);
  restored.restore(saved); assert.deepEqual(restored.snapshot(), saved);
  const before = restored.snapshot(), lease = restored.openBattle(content.encounterId);
  const inventory = restored.battleInventory(lease);
  assert.deepEqual(inventory.qualification!.members[0]!.equipment.slice(0, 2), [1, 162]);
  const battle = new BattleGame(content, 2219, restored.battlePlayers(lease), inventory);
  assert.equal(battle.players[0]!.physical!.attack, 50);
  assert.throws(() => restored.changeEquipment("a", 2, 1), /active battle/);
  inventory.qualification!.members[0]!.equipment[1] = 999;
  assert.equal(battle.canUse("a", 13, 100), true);
  restored.cancelBattle(lease); assert.deepEqual(restored.snapshot(), before);
  const invalid = structuredClone(saved);
  invalid.equipmentStock.find((entry: { id: number; count: number }) => entry.id === 162)!.count = 0;
  assert.throws(() => restored.restore(invalid), /owned count/);
  assert.deepEqual(restored.snapshot(), saved);
});

test("real BattleGame keeps ranged damage identical across actor and friendly-target rows", () => {
  const amounts: number[] = [];
  for (const actorRow of ["front", "back"] as const) for (const targetRow of ["front", "back"] as const) {
    const { state, content } = setup();
    const initial = state.snapshot();
    initial.party.slots[initial.party.selectedSlot]![0]!.row = actorRow;
    initial.party.slots[initial.party.selectedSlot]![1]!.row = targetRow;
    state.restore(initial);
    const lease = state.openBattle(content.encounterId);
    const battle = new BattleGame(content, 2221, state.battlePlayers(lease), state.battleInventory(lease));
    battle.combatants.forEach((unit) => { unit.atb = 0; }); battle.players[0]!.atb = 100;
    assert.equal(battle.command("a", 13, "b", 100), true);
    battle.advance(410);
    assert.equal(battle.action?.resolved, true);
    const effect = battle.action!.results[0]!.effects[0]!;
    assert.equal(effect.resource, "hp");
    assert.ok("amount" in effect);
    amounts.push(effect.amount);
    state.cancelBattle(lease);
    assert.deepEqual(state.snapshot(), initial);
  }
  assert.ok(amounts[0]! > 0); assert.deepEqual(amounts, Array(4).fill(amounts[0]));
});

test("row metadata mismatch refuses commands and an execution-time failure rolls the entire frame back", () => {
  const first = setup(), second = setup();
  const begin = (fixture: ReturnType<typeof setup>) => {
    const lease = fixture.state.openBattle(fixture.content.encounterId);
    const battle = new BattleGame(fixture.content, 2237, fixture.state.battlePlayers(lease), fixture.state.battleInventory(lease));
    battle.combatants.forEach((unit) => { unit.atb = 0; }); battle.players[0]!.atb = 100;
    return { battle, lease };
  };
  const a = begin(first), b = begin(second);
  const row = first.content.battleRows!.equipment.find((entry) => entry.contentId === 162)!;
  row.weapon!.backFlag = 0;
  const view = (battle: BattleGame) => structuredClone({ combatants: battle.combatants, queue: battle.pendingActions,
    action: battle.action, time: battle.time, events: battle.events });
  const beforeCommand = view(a.battle);
  assert.equal(a.battle.canUse("a", 13, 100), false);
  assert.equal(a.battle.command("a", 13, "e1", 100), false);
  assert.deepEqual(view(a.battle), beforeCommand);
  row.weapon!.backFlag = 1;
  for (const battle of [a.battle, b.battle]) {
    assert.equal(battle.command("a", 13, "e1", 100), true);
    battle.advance(400);
    assert.equal(battle.action?.resolved, false);
    assert.equal(battle.action?.elapsed, 390);
  }
  // Actor admission is still valid. A target-only row failure must unwind the
  // execution frame, not publish a partial action or consume random state.
  a.battle.enemies[0]!.row = "unknown" as never;
  const beforeFrame = view(a.battle);
  assert.throws(() => a.battle.advance(10), /row/i);
  assert.deepEqual(view(a.battle), beforeFrame);
  a.battle.enemies[0]!.row = "front"; a.battle.advance(10); b.battle.advance(10);
  assert.deepEqual(view(a.battle), view(b.battle));
  first.state.cancelBattle(a.lease); second.state.cancelBattle(b.lease);
});
