import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { parseBattlePreferences } from "../src/core/battle-preferences.js";
import { fixture } from "./fixtures/battle-content.js";

const running = {
  paused: false,
  helpPaused: false,
  progressEnabled: true,
  uiWaiting: false,
  forceWaiting: false,
};

function setup() {
  const content = fixture();
  content.enemies.forEach((enemy) => { enemy.hp = 9999; });
  content.conditions.rules.definitions.push({
    id: 310, type: 10, overlapped: false, eraseGroupId: 3,
  });
  content.conditions.behaviors.push({
    id: 310, kind: "poison", name: "Poison", untilType: 3, hpDivisor: 16,
  });
  content.players[0]!.conditionIds = [310];
  content.abilities[11]!.wait = 30;
  return { content, battle: new BattleGame(content, 108) };
}

test("battle preferences validate the explicit mode without inventing speed slots", () => {
  for (const mode of ["active", "wait"] as const) {
    const value = { mode };
    assert.deepEqual(parseBattlePreferences(value), value);
    assert.notEqual(parseBattlePreferences(value), value);
  }
  for (const raw of [null, [], "wait", {}, { mode: 0 }, { mode: "WAIT" },
    { mode: "active", speed: 1 }, { mode: "active", extra: false }])
    assert.throws(() => parseBattlePreferences(raw), /Invalid battle preferences/);
});

test("switching active/wait preserves source content, pending charge and condition clocks", () => {
  const { content, battle } = setup();
  const source = structuredClone(content);
  assert.equal(battle.command("b", 11, "b"), true);
  battle.advance(120);
  const before = {
    gauge: battle.enemies[0]!.atb,
    charge: battle.pendingActions[0]!.charge,
    poison: battle.conditionClockState("a"),
  };
  const preferences = { mode: "wait" as const };
  battle.setPreferences(preferences);
  battle.setClockInput({ ...running, uiWaiting: true });
  battle.advance(300);
  assert.equal(battle.enemies[0]!.atb, before.gauge);
  assert.equal(battle.pendingActions[0]!.charge, before.charge);
  assert.deepEqual(battle.conditionClockState("a"), before.poison);
  assert.equal(battle.timingState.gate.simulation, true);
  assert.equal(battle.timingState.gate.progress, false);
  assert.notEqual(battle.preferences, preferences);
  battle.setPreferences({ mode: "active" });
  battle.advance(10);
  assert.ok(battle.enemies[0]!.atb > before.gauge);
  assert.ok(battle.pendingActions[0]!.charge < before.charge);
  assert.ok(battle.conditionClockState("a")[0]!.elapsedSeconds > before.poison[0]!.elapsedSeconds);
  assert.deepEqual(content, source);
});

test("waiting keeps an existing action moving while pause suspends it and preserves the submenu", () => {
  const { battle } = setup();
  battle.command("a", 10, "e1");
  battle.advance(10);
  battle.setPreferences({ mode: "wait" });
  battle.setClockInput({ ...running, uiWaiting: true });
  battle.advance(200);
  assert.equal(battle.action?.elapsed, 200);
  const before = structuredClone({ action: battle.action, time: battle.time, units: battle.combatants });
  battle.setClockInput({ ...running, uiWaiting: true, paused: true });
  battle.advance(5000);
  assert.deepEqual({ action: battle.action, time: battle.time, units: battle.combatants }, before);
  battle.setClockInput({ ...running, uiWaiting: true });
  battle.advance(10);
  assert.equal(battle.action?.elapsed, 210);
  assert.equal(battle.timingState.gate.progress, false);
  assert.deepEqual(battle.combatants, before.units);
});

test("force-wait and help pause remain independent of the selected mode", () => {
  const { battle } = setup();
  for (const mode of ["active", "wait"] as const) {
    battle.setPreferences({ mode });
    battle.setClockInput({ ...running, forceWaiting: true });
    assert.deepEqual(battle.timingState.gate, { simulation: true, progress: false, conditions: false });
    battle.setClockInput({ ...running, helpPaused: true });
    assert.deepEqual(battle.timingState.gate, { simulation: false, progress: false, conditions: false });
    const time = battle.time;
    battle.advance(100);
    assert.equal(battle.time, time);
  }
});

test("settings/readout copies and invalid writes cannot alter live timing", () => {
  const { battle } = setup();
  const preferences = battle.preferences;
  preferences.mode = "wait";
  const readout = battle.timingState;
  readout.input.paused = true;
  readout.gate.progress = false;
  readout.atbSpeed = 99;
  assert.equal(battle.preferences.mode, "active");
  assert.equal(battle.timingState.input.paused, false);
  assert.equal(battle.timingState.gate.progress, true);
  assert.equal(battle.timingState.atbSpeed, 1);
  const before = battle.timingState;
  assert.throws(() => battle.setPreferences({ mode: "unknown" } as never), /preferences/);
  assert.deepEqual(battle.timingState, before);
});
