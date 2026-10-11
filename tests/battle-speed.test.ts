import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import type { AbilityDefinition } from "../src/core/battle-content.js";
import { atbIncrement } from "../src/core/atb.js";
import { conditionSpeedFixture } from "./fixtures/condition-speed.js";
import { fixture } from "./fixtures/battle-content.js";

const running = { paused: false, helpPaused: false, progressEnabled: true, uiWaiting: false, forceWaiting: false };
function setup(initial: number[] = [125], playerAtb = 0) {
  const content = fixture();
  content.conditions = conditionSpeedFixture().compile().catalog;
  content.initialAtb.player = [playerAtb, playerAtb];
  for (const unit of content.players) unit.physical = null;
  for (const enemy of content.enemies) { enemy.hp = 9999; enemy.agility = 0; enemy.weight = content.atb.coefficient; }
  content.players[0]!.conditionIds = [...initial];
  for (const [id, conditionId] of [[901, 121], [902, 125]] as const) {
    const d: AbilityDefinition = structuredClone(content.abilities[10]!);
    Object.assign(d, { id, name: "Synthetic speed " + id, cost: 0, wait: 0, power: 0, presentation: "condition" });
    d.program = { ...d.program, abilityId: id, range: 7, rules: { system_id: conditionId === 121 ? 2 : 5, type_id: 1 },
      functions: [{ slot: 1, functionId: 501, type: 9, series: 0, values: [conditionId, 1, 0] }] };
    d.plan = { effects: [{ slot: 1, kind: "add-condition", conditionId, fixedHit: true, accuracy: 255 }],
      targeting: { relation: "either", modes: ["single"], defaultMode: "single", defaultRelation: "ally", normalFormationOnly: false, life: "alive" },
      physical: null, magic: null };
    content.abilities[id] = d;
    for (const player of content.players) player.abilities.push(id);
    content.commands[100]!.abilityIds.push(id);
  }
  return { content, battle: new BattleGame(content, 0x2515) };
}
const frame = Math.fround(0.01);
const accumulated = (frames: number) => {
  let value = 0; for (let i = 0; i < frames; i++) value = Math.fround(value + frame); return value;
};
function present(battle: BattleGame, id: number, target = "a") {
  const caster = battle.players.find((p) => p.id === "b")!;
  caster.atb = 100;
  assert.equal(battle.command("b", id, target), true);
  battle.advance(410);
  assert.equal(battle.action?.resolved, true);
  battle.advance(500);
  assert.equal(battle.action, null);
}

test("live Haste and Slow IDs drive ATB percentages while WAIT gates both ATB and Slow.Update", () => {
  for (const [id, percent] of [[121, 150], [125, 50]] as const) {
    const { content, battle } = setup([id]);
    const player = battle.players[0]!;
    battle.advance(10);
    const expected = atbIncrement(content.atb, { agility: player.agility, weight: player.weight,
      enemy: false, speedPercent: percent, battleSpeed: content.timing.atbSpeed, seconds: 0.01 });
    assert.equal(player.atb, expected);
    assert.deepEqual(battle.slowClockState("a"), id === 125 ? [{ conditionId: 125, elapsedSeconds: frame }] : []);
    const clock = battle.slowClockState("a"), gauge = player.atb;
    battle.setPreferences({ mode: "wait" }); battle.setClockInput({ ...running, uiWaiting: true });
    battle.advance(200);
    assert.equal(player.atb, gauge); assert.deepEqual(battle.slowClockState("a"), clock);
    assert.deepEqual(battle.timingState.gate, { simulation: true, progress: false, conditions: false });
    battle.setPreferences({ mode: "active" }); battle.advance(10);
    assert.ok(player.atb > gauge);
    if (id === 125) assert.equal(battle.slowClockState("a")[0]!.elapsedSeconds, accumulated(2));
  }
});

test("Slow.Update continues through action presentation but respects pause and force-wait", () => {
  const { battle } = setup([125], 100);
  assert.equal(battle.command("b", 10, "e1"), true); battle.advance(10);
  assert.ok(battle.action); battle.advance(200);
  assert.equal(battle.slowClockState("a")[0]!.elapsedSeconds, accumulated(21));
  const before = battle.slowClockState("a"), actionTime = battle.action.elapsed;
  battle.setClockInput({ ...running, forceWaiting: true }); battle.advance(100);
  assert.deepEqual(battle.slowClockState("a"), before); assert.equal(battle.action?.elapsed, actionTime + 100);
  battle.setClockInput({ ...running, paused: true }); const time = battle.time; battle.advance(1000);
  assert.equal(battle.time, time); assert.deepEqual(battle.slowClockState("a"), before);
  battle.setClockInput(running); battle.advance(10);
  assert.equal(battle.slowClockState("a")[0]!.elapsedSeconds, accumulated(22));
});

test("resolved status replacement resets Slow lifetime while poison retains its current interval", () => {
  const { battle } = setup([110, 125], 100);
  assert.equal(battle.conditionClockState("a")[0]!.thresholdSeconds, 16);
  battle.advance(100);
  present(battle, 901);
  assert.deepEqual(battle.players[0]!.conditionIds, [110, 121]);
  assert.deepEqual(battle.slowClockState("a"), []);
  assert.equal(battle.conditionClockState("a")[0]!.thresholdSeconds, 16);
  present(battle, 902);
  assert.deepEqual(battle.players[0]!.conditionIds, [110, 125]);
  assert.equal(battle.slowClockState("a")[0]!.elapsedSeconds, accumulated(51));
  const previous = battle.slowClockState("a")[0]!.elapsedSeconds;
  present(battle, 902); // Duplicate application misses and cannot restart Slow.
  let expected = previous; for (let i = 0; i < 91; i++) expected = Math.fround(expected + frame);
  assert.equal(battle.slowClockState("a")[0]!.elapsedSeconds, expected);
  present(battle, 901);
  const hp = battle.players[0]!.hp;
  for (let i = 0; i < 1800 && battle.players[0]!.hp === hp; i++) battle.advance(10);
  assert.equal(battle.players[0]!.hp, hp - 5);
  assert.equal(battle.conditionClockState("a")[0]!.thresholdSeconds, 8);
});

test("a failed step after condition publication rolls back Slow, poison, ATB, AI and time", () => {
  const { content, battle } = setup([110, 125]);
  battle.advance(100);
  battle.enemies[0]!.atb = 100;
  const before = { units: structuredClone(battle.combatants), slow: battle.slowClockState("a"), poison: battle.conditionClockState("a"),
    events: structuredClone(battle.events), time: battle.time, ai: battle.enemyAIState("e1"), pending: battle.pendingActions };
  const definition = content.abilities[13]!;
  const saved = definition.plan; definition.plan = null;
  assert.throws(() => battle.advance(10), /ability|能力|effect|action|unsupported/i);
  assert.deepEqual(battle.combatants, before.units);
  assert.deepEqual(battle.slowClockState("a"), before.slow);
  assert.deepEqual(battle.conditionClockState("a"), before.poison);
  assert.deepEqual(battle.events, before.events); assert.equal(battle.time, before.time);
  assert.deepEqual(battle.enemyAIState("e1"), before.ai); assert.deepEqual(battle.pendingActions, before.pending);
  definition.plan = saved;
  battle.advance(0);
  assert.equal(battle.time, before.time + 10);
  assert.equal(battle.slowClockState("a")[0]!.elapsedSeconds, accumulated(11));
  const copy = battle.slowClockState("a"); copy[0]!.elapsedSeconds = 99;
  assert.equal(battle.slowClockState("a")[0]!.elapsedSeconds, accumulated(11));
});

test("poison death clears Slow clock and victory removes battle-only speed identities", () => {
  const { battle } = setup([110, 125]);
  battle.players[0]!.hp = 1;
  battle.advance(16010);
  assert.equal(battle.players[0]!.hp, 0);
  assert.deepEqual(battle.players[0]!.conditionIds, [5]);
  assert.deepEqual(battle.slowClockState("a"), []);
  assert.deepEqual(battle.conditionClockState("a"), []);
  assert.equal(battle.players[0]!.atb, 0);
  const other = setup([121]);
  other.battle.enemies.forEach((enemy) => { enemy.hp = 0; });
  other.battle.advance(10);
  assert.equal(other.battle.phase, "victory");
  assert.deepEqual(other.battle.previewVictory()!.players[0]!.conditionIds, []);
  assert.throws(() => other.battle.slowClockState("a"), /Unknown slow/);
});
