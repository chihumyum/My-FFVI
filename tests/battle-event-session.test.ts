import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import type { BattleEventOp, BattleEventProgram } from "../src/core/battle-event.js";
import { battleEventUnitEnded } from "../src/core/battle-event-context.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";
import { GameSession } from "../src/core/game-session.js";

const rules = { conditions: [
  { id: 305, type: 5, attackTarget: 1, gameOverTarget: 1 },
  { id: 304, type: 4, attackTarget: 0, gameOverTarget: 0 },
] };
function program(ops: BattleEventOp[]): BattleEventProgram {
  return { kind: "battle-event-v1", source: null, entry: 0, end: ops.length,
    localNames: ["BattleAIFlag", "Counter"], initialLocals: [0, 0], blockers: [],
    instructions: ops.map(op => ({ mnemonic: op.kind, op })) };
}
function activeProgram(ops: BattleEventOp[]): BattleEventProgram {
  // A native root Exit is terminal, not a way to leave combat running.
  return program([...ops, { kind: "nop" }, { kind: "blank" }, { kind: "jump", target: ops.length }]);
}
function ordinaryProgram(): BattleEventProgram {
  return program([
    { kind: "exec-ai" }, { kind: "blank" }, { kind: "sync-ai" },
    { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: 0 },
    { kind: "wait", seconds: 0.04 }, { kind: "exit" },
  ]);
}
function closingProgram(seconds = 0.04): BattleEventProgram {
  return program([
    { kind: "exec-ai" }, { kind: "end-enabled", enabled: false },
    { kind: "blank" }, { kind: "sync-ai" },
    { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: 1 },
    { kind: "sync-action" }, { kind: "wait", seconds },
    { kind: "end-enabled", enabled: true }, { kind: "exit" },
  ]);
}
function content(event = closingProgram()) {
  const c = fixture(); c.enemies = [c.enemies[0]!]; c.battleEvents = structuredClone(rules);
  c.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 9000, program: event };
  return c;
}
function until(battle: BattleGame, predicate: () => boolean, limit = 5000) {
  for (let elapsed = 0; elapsed < limit && !predicate(); elapsed += 10) battle.advance(10);
  assert.equal(predicate(), true, "battle did not reach the requested system boundary");
}
function snapshot(battle: BattleGame) {
  return { time: battle.time, units: structuredClone(battle.combatants), event: battle.eventExecution,
    action: structuredClone(battle.action), pending: battle.pendingActions, reward: battle.reward,
    phase: battle.phase, events: structuredClone(battle.events),
    ai: battle.enemies.map(enemy => battle.enemyAIState(enemy.id)) };
}

test("AI starts at the event request, with no premature initialization or duplicate owner", () => {
  const c = content(activeProgram([{ kind: "wait", seconds: 0.03 }, { kind: "exec-ai" }]));
  c.enemies[0]!.ai = syntheticAI([
    ["VariableAssign", [0, 7]], ["Nop"], ["SyncAI"], ["StartTable", [0]],
    ["Act", [13]], ["EndTable"], ["JumpBattleAI", [1]],
  ]);
  const battle = new BattleGame(c, 27);
  assert.equal(battle.enemyAIState("e1"), null);
  assert.equal(battle.enemies[0]!.behavior!.variables[0], 0);
  battle.advance(20); assert.equal(battle.enemyAIState("e1"), null);
  battle.advance(10);
  assert.equal(battle.enemyAIState("e1")!.status, "waiting");
  assert.equal(battle.enemies[0]!.behavior!.variables[0], 7);
  assert.equal(battle.eventExecution.controls.aiStarted, true);
  assert.equal(battle.phase, "active");
});

test("last damage waits for the shared action executor and script end permission before rewards", () => {
  const battle = new BattleGame(content(), 29);
  assert.equal(battle.command("a", 10, "e1"), true);
  until(battle, () => battle.enemies[0]!.hp === 0);
  assert.ok(battle.action); assert.equal(battle.phase, "active");
  assert.equal(battle.eventExecution.state!.locals[0], 0);
  assert.equal(battle.enemyAIState("e1")!.status, "waiting");
  until(battle, () => battle.eventExecution.state!.wait?.kind === "time");
  assert.equal(battle.action, null);
  assert.equal(battle.enemyAIState("e1")!.status, "exited");
  assert.equal(battle.eventExecution.state!.locals[0], 1);
  assert.equal(battle.eventExecution.controls.updateEnabled, false);
  assert.equal(battle.reward, null); assert.equal(battle.phase, "active");
  until(battle, () => battle.phase === "victory");
  assert.equal(battle.eventExecution.state!.status, "exited");
  assert.equal(battle.reward!.gil, 7);
  assert.ok(battle.takeVictory()); assert.equal(battle.takeVictory(), null);
});

test("event pause blocks new normal actions while staged actions and the script clock continue", () => {
  const event = activeProgram([
    { kind: "exec-ai" }, { kind: "blank" }, { kind: "pause", enabled: true },
    { kind: "sync-action" }, { kind: "wait", seconds: 0.03 },
    { kind: "pause", enabled: false },
  ]);
  const c = content(event); c.enemies[0]!.hp = 9999;
  const battle = new BattleGame(c, 31);
  assert.equal(battle.command("a", 10, "e1"), true);
  assert.equal(battle.command("b", 10, "e1"), true);
  battle.advance(10);
  assert.ok(battle.action); assert.equal(battle.eventExecution.controls.updateEnabled, false);
  const atb = battle.enemies[0]!.atb;
  battle.advance(100);
  assert.equal(battle.enemies[0]!.atb, atb);
  assert.equal(battle.action!.elapsed, 100);
  until(battle, () => battle.eventExecution.state!.wait?.kind === "time");
  assert.equal(battle.action, null);
  assert.equal(battle.pendingActions.length, 1, "SyncAction does not wait for a normal queued turn");
  assert.equal(battle.eventExecution.controls.updateEnabled, false);
  until(battle, () => battle.eventExecution.controls.updateEnabled);
  assert.equal(battle.eventExecution.controls.updateEnabled, true);
  battle.advance(10); assert.equal(snapshot(battle).action?.actor, "b");
});

test("interactive control affects command input independently of the progress clock", () => {
  const battle = new BattleGame(content(activeProgram([
    { kind: "exec-ai" }, { kind: "interactive", enabled: false },
    { kind: "wait", seconds: 0.03 }, { kind: "interactive", enabled: true },
  ])), 37);
  assert.equal(battle.command("a", 10, "e1"), false);
  const atb = battle.enemies[0]!.atb; battle.advance(20);
  assert.ok(battle.enemies[0]!.atb > atb);
  assert.equal(battle.command("a", 10, "e1"), false);
  battle.advance(10); assert.equal(battle.command("a", 10, "e1"), true);
});

test("interrupt actions drain through the existing queue while an event pauses ordinary progress", () => {
  const c = content(activeProgram([
    { kind: "exec-ai" }, { kind: "blank" }, { kind: "pause", enabled: true },
    { kind: "sync-action" }, { kind: "pause", enabled: false },
  ]));
  c.enemies[0]!.hp = 9999;
  c.enemies[0]!.ai = syntheticAI([
    ["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [13]], ["CounterAct", [13]],
    ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  const battle = new BattleGame(c, 39);
  assert.equal(battle.command("a", 10, "e1"), true);
  until(battle, () => battle.action?.kind === "counter");
  assert.equal(battle.eventExecution.controls.updateEnabled, false);
  assert.equal(battle.eventExecution.state!.wait?.kind, "action");
  until(battle, () => battle.eventExecution.controls.updateEnabled);
  assert.equal(battle.action, null);
  assert.equal(battle.pendingActions.length, 0);
  assert.equal(battle.eventExecution.controls.updateEnabled, true);
});

test("terminal permission applies to defeat and to an accepted retreat while the VM keeps advancing", () => {
  const c = content(program([
    { kind: "exec-ai" }, { kind: "end-enabled", enabled: false },
    { kind: "wait", seconds: 0.03 }, { kind: "end-enabled", enabled: true }, { kind: "exit" },
  ]));
  const battle = new BattleGame(c, 41);
  for (const player of battle.players) { player.hp = 0; player.conditionIds = [305]; }
  battle.advance(20); assert.equal(battle.phase, "active");
  battle.advance(10); assert.equal(battle.phase, "defeat");
  const escapeContent = content(activeProgram([
    { kind: "exec-ai" }, { kind: "blank" }, { kind: "end-enabled", enabled: false },
    { kind: "pause", enabled: true }, { kind: "wait", seconds: 0.03 },
    { kind: "pause", enabled: false }, { kind: "end-enabled", enabled: true },
  ]));
  escapeContent.escapePolicy = { kind: "framework-battle-escape-v1", id: "controlled-retreat" };
  const escaping = new BattleGame(escapeContent, 43);
  assert.equal(escaping.requestEscape(), true);
  escaping.advance(20); assert.equal(escaping.phase, "active");
  until(escaping, () => escaping.phase === "escaped");
  assert.equal(escaping.reward, null);
});

test("root completion gates victory even with end permission, but cannot hold a defeated party", () => {
  const battle = new BattleGame(content(ordinaryProgram()), 44);
  assert.equal(battle.command("a", 10, "e1"), true);
  until(battle, () => battle.eventExecution.state!.wait?.kind === "time");
  assert.equal(battle.eventExecution.controls.endEnabled, true);
  assert.equal(battle.enemies[0]!.hp, 0);
  assert.equal(battle.reward, null); assert.equal(battle.phase, "active");
  until(battle, () => battle.phase === "victory");
  assert.equal(battle.eventExecution.state!.status, "exited");
  const defeated = new BattleGame(content(ordinaryProgram()), 45);
  for (const player of defeated.players) { player.hp = 0; player.conditionIds = [305]; }
  defeated.advance(10);
  assert.notEqual(defeated.eventExecution.state!.status, "exited");
  assert.equal(defeated.phase, "defeat");
  const simultaneous = new BattleGame(content(program([{ kind: "exec-ai" }, { kind: "exit" }])), 451);
  for (const actor of simultaneous.combatants) { actor.hp = 0; actor.conditionIds = [305]; }
  simultaneous.advance(10);
  assert.equal(simultaneous.phase, "defeat"); assert.equal(simultaneous.reward, null);
});

test("an early root Exit cannot silently use the all-defeated reward provider", () => {
  const battle = new BattleGame(content(program([{ kind: "exec-ai" }, { kind: "exit" }])), 46);
  const before = snapshot(battle);
  assert.throws(() => battle.advance(10), /live enemies.*result provider/);
  assert.deepEqual(snapshot(battle), before);
  assert.equal(battle.reward, null);
});

test("the condition-based AI end predicate is not HP or targetability, and unknown rules remain blocked", () => {
  const r = { conditions: [
    ...rules.conditions, { id: 3, type: 3, attackTarget: 0, gameOverTarget: 0 },
    { id: 7, type: 7, attackTarget: 1, gameOverTarget: 0 },
    { id: 602, type: 602, attackTarget: 0, gameOverTarget: 0 },
  ] };
  assert.equal(battleEventUnitEnded(r, [3]), true);
  assert.equal(battleEventUnitEnded(r, [305]), true);
  assert.equal(battleEventUnitEnded(r, [7]), false);
  assert.throws(() => battleEventUnitEnded(r, [602]), /602/);
  assert.throws(() => battleEventUnitEnded(r, [999]), /Missing/);
});

test("failed terminal projection rolls back event permission, PC, queues and logical time", () => {
  const c = content(), battle = new BattleGame(c, 47, undefined, undefined,
    () => { throw new Error("controlled progression unavailable"); });
  assert.equal(battle.command("a", 10, "e1"), true);
  until(battle, () => battle.eventExecution.state!.wait?.kind === "time");
  let before = snapshot(battle), failed = false;
  for (let i = 0; i < 20; i++) {
    before = snapshot(battle);
    try { battle.advance(10); }
    catch (error) { assert.match(String(error), /controlled progression unavailable/); failed = true; break; }
  }
  assert.equal(failed, true); assert.deepEqual(snapshot(battle), before);
  assert.equal(battle.reward, null); assert.equal(battle.eventExecution.controls.endEnabled, false);
});

test("frame partition and detached inspection preserve one event/AI/action result", () => {
  const first = new BattleGame(content(), 53), second = new BattleGame(content(), 53);
  const inspected = first.eventExecution; inspected.controls.endEnabled = true;
  inspected.state!.locals[0] = 999;
  first.lifecycleDefinition.mode = "none";
  assert.equal(first.eventExecution.controls.endEnabled, false);
  assert.equal(first.eventExecution.state!.locals[0], 0);
  for (const battle of [first, second]) assert.equal(battle.command("a", 10, "e1"), true);
  first.advance(2000); for (let i = 0; i < 200; i++) second.advance(10);
  assert.deepEqual(snapshot(first), snapshot(second));
});

test("retry, field return and save use the same admitted lifecycle and publish its reward once", () => {
  const f = characterLearningSessionFixture();
  const encounter = f.battle.encounters[1000]!;
  f.battle.common.battleEvents = { conditions: f.battle.common.conditions.rules.definitions.map(({ id, type }) =>
    ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  encounter.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 9000,
    program: ordinaryProgram() };
  encounter.lifecycle.program.source = { sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64),
    file: "synthetic", sha256: "c".repeat(64), assetPath: "synthetic/event.json",
    serializedFile: "synthetic", objectId: "9000" };
  const session = f.make(); session.field.startEvent("learning"); session.advance(10);
  assert.ok(session.battle, JSON.stringify(session.field.stop));
  const ownedBefore = session.state.snapshot();
  session.battle!.content.lifecycle = { kind: "battle-lifecycle-v1", mode: "none" };
  for (const player of session.battle!.players) {
    player.hp = 0; player.conditionIds = [session.battle!.content.conditions.hpZeroConditionId];
  }
  session.battle!.advance(10); assert.equal(session.battle!.phase, "defeat");
  assert.equal(session.retryBattle(), true);
  assert.equal(session.battle!.lifecycleDefinition.mode, "script");
  assert.deepEqual(session.state.snapshot(), ownedBefore);
  until(session.battle!, () => session.battle!.ready.length > 0);
  assert.equal(session.battle!.command(f.id, 10, "e1", 100), true);
  until(session.battle!, () => session.battle!.phase === "victory");
  assert.equal(session.continueVictory(), true); session.advance(10);
  assert.equal(session.continueVictory(), false);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  const restored = GameSession.restore(saved, session.field.content, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } });
  assert.deepEqual(restored.checkpoint().origin, saved.origin);
  assert.deepEqual(restored.state.snapshot(), session.state.snapshot());
  assert.equal(restored.state.snapshot().completedBattles.length, 1);
});
