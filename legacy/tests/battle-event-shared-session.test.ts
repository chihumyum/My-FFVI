import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { GameSession } from "../src/core/game-session.js";
import { EventState, type VariableRef } from "../src/core/event-state.js";
import { battleEventSharedSnapshot } from "../src/core/battle-event-shared.js";
import type { BattleEventOp, BattleEventProgram } from "../src/core/battle-event.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { fixture } from "./fixtures/battle-content.js";
import { walkEncounterFixture, walkHost } from "./fixtures/walk-encounter-game.js";
import { GameFlow } from "../src/core/game-flow.js";

const flag: VariableRef = { category: "ScenarioFlag1", index: 52 };
const global: VariableRef = { category: "ScenarioVariable", index: 3 };
function program(ops: BattleEventOp[]): BattleEventProgram {
  return { kind: "battle-event-v1", source: null, entry: 0, end: ops.length, localNames: ["AI", "BattleLocal"],
    initialLocals: [0, 0], instructions: ops.map(op => ({ mnemonic: op.kind, op })), blockers: [] };
}
function ordinary(): BattleEventProgram {
  return program([
    { kind: "exec-ai" }, { kind: "blank" }, { kind: "variable-flag", ref: flag, operation: "set" },
    { kind: "variable-calc", left: global, operator: "←", right: { kind: "immediate", value: 7 } },
    { kind: "variable-calc", left: { category: "ScriptLocalVariable", index: 1 }, operator: "←",
      right: { kind: "variable", ref: global } },
    { kind: "nop" }, { kind: "blank" }, { kind: "players-ended" }, { kind: "sync-ai" },
    { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: 5 },
    { kind: "exit" },
  ]);
}
function setup() {
  const f = checkpointFixture();
  f.battle.common.battleEvents = { conditions: f.battle.common.conditions.rules.definitions.map(({ id, type }) =>
    ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  f.battle.encounters[1000]!.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1, program: ordinary() };
  f.field.scriptLocals = { fight: { labels: ["SuspendedFieldLocal"], values: [88] },
    after: { labels: ["ReturnedFieldLocal"], values: [42] } };
  const game = new GameSession(f.field, f.battle, 314);
  game.field.eventState.write(flag, 0); game.field.eventState.write(global, 0);
  game.field.eventState.write({ category: "ScenarioVariable", index: 4 }, 0);
  game.field.startEvent("fight"); game.advance(10);
  assert.ok(game.battle); game.advance(10);
  return { ...f, game };
}
function win(game: GameSession): void {
  for (let n = 0; n < 20000 && game.battle?.phase === "active"; n++) {
    const battle = game.battle;
    for (const actor of battle.ready) {
      const target = battle.targets(actor.id, 10)[0];
      if (target) battle.command(actor.id, 10, target.id);
    }
    game.advance(10);
  }
  assert.equal(game.battle?.phase, "victory");
}

test("battle state, field locals, reward publication and save share one continuous session", () => {
  const f = setup(), game = f.game, owner = game.field.eventState, before = game.state.snapshot();
  assert.equal(owner.read(flag), 0); assert.equal(owner.read(global), 0);
  assert.deepEqual(owner.snapshot().script, [88]);
  assert.deepEqual(game.battle!.eventExecution.state!.locals, [0, 7]);
  assert.equal(game.battle!.eventSharedReturn!.candidate.scenario[52], 1);
  win(game); assert.deepEqual(game.state.snapshot(), before); assert.equal(owner.read(flag), 0);
  assert.equal(game.continueVictory(), true); assert.equal(game.continueVictory(), false);
  assert.equal(game.field.eventState, owner);
  assert.equal(owner.read(flag), 1); assert.equal(owner.read(global), 7);
  assert.deepEqual(owner.snapshot().script, [42]);
  game.advance(10); const saved = JSON.parse(JSON.stringify(game.checkpoint()));
  const restored = GameSession.restore(saved, f.field, f.battle);
  assert.deepEqual(restored.checkpoint(), game.checkpoint());
  assert.equal(restored.field.eventState.read(flag), 1);
  assert.equal(restored.field.eventState.read(global), 7);
  restored.field.startEvent("fight"); restored.advance(20); win(restored);
  assert.equal(restored.continueVictory(), true); restored.advance(10);
  assert.equal(restored.state.snapshot().completedBattles.length, 2);
  assert.equal(restored.field.eventState.read(global), 7);
});

test("defeat and retry discard candidate flags and restore the fixed entry banks", () => {
  const { game } = setup(), entry = game.battle!.eventSharedEntry;
  const before = game.state.snapshot(), field = game.field.eventState.snapshot();
  game.battle!.content.lifecycle = { kind: "battle-lifecycle-v1", mode: "none" };
  for (const player of game.battle!.players) {
    player.hp = 0; player.conditionIds = [game.battle!.content.conditions.hpZeroConditionId];
  }
  game.advance(10); assert.equal(game.battle!.phase, "defeat");
  assert.equal(game.field.eventState.read(flag), 0);
  assert.equal(game.retryBattle(), true);
  assert.equal(game.battle!.lifecycleDefinition.mode, "script");
  assert.deepEqual(game.battle!.eventSharedEntry, entry);
  assert.equal(game.battle!.eventSharedReturn!.candidate.global[3], 0);
  assert.deepEqual(game.state.snapshot(), before); assert.deepEqual(game.field.eventState.snapshot(), field);
  game.advance(10); assert.equal(game.battle!.eventSharedReturn!.candidate.global[3], 7);
  win(game); assert.equal(game.continueVictory(), true);
  assert.equal(game.field.eventState.read(flag), 1); assert.equal(game.state.snapshot().completedBattles.length, 1);
});

test("missing continuation or stale event reads cannot publish rewards or staged flags", () => {
  const { game } = setup(), before = game.state.snapshot(), after = game.field.content.scripts.after;
  win(game); const battle = game.battle;
  delete game.field.content.scripts.after;
  assert.throws(() => game.continueVictory(), /Missing battle continuation/);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(game.field.eventState.read(flag), 0);
  game.field.content.scripts.after = after!;
  const unrelated: VariableRef = { category: "ScenarioVariable", index: 4 };
  game.field.eventState.write(unrelated, 100);
  assert.throws(() => game.continueVictory(), /Stale shared battle event/);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(game.field.eventState.read(flag), 0);
  assert.equal(game.battle, battle); assert.ok(battle!.previewVictory());
  game.field.eventState.write(unrelated, 0);
  assert.equal(game.continueVictory(), true); assert.equal(game.field.eventState.read(flag), 1);
});

test("a late failing host request rolls back flags, locals, AI, time and RNG in the same frame", () => {
  const content = fixture(), owner = EventState.initialized();
  content.battleEvents = { conditions: content.conditions.rules.definitions.map(({ id, type }) =>
    ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  content.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1, program: program([
    { kind: "exec-ai" }, { kind: "blank" }, { kind: "variable-flag", ref: flag, operation: "set" },
    { kind: "variable-calc", left: global, operator: "←", right: { kind: "immediate", value: 23 } },
    { kind: "exec-ai" }, { kind: "exit" },
  ]) };
  const battle = new BattleGame(content, 314, undefined, undefined, undefined, undefined, battleEventSharedSnapshot(owner));
  const snapshot = () => ({ time: battle.time, event: battle.eventExecution, shared: battle.eventSharedReturn,
    units: structuredClone(battle.combatants), queues: battle.pendingActions, events: [...battle.events],
    ai: battle.enemies.map(enemy => battle.enemyAIState(enemy.id)) });
  const before = snapshot();
  assert.throws(() => battle.advance(10), /already running/); assert.deepEqual(snapshot(), before);
  assert.equal(owner.read(flag), 0); assert.equal(battle.eventSharedReturn!.candidate.global[3], 0);
  assert.throws(() => battle.advance(0), /already running/); assert.deepEqual(snapshot(), before);
});

test("ordinary escape publishes the same staged plot banks and preserves field local frames", () => {
  const f = walkEncounterFixture(1);
  f.battle.common.battleEvents = { conditions: f.battle.common.conditions.rules.definitions.map(({ id, type }) =>
    ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  f.battle.encounters[1000]!.escapePolicy = { kind: "framework-battle-escape-v1", id: "synthetic" };
  f.battle.encounters[1000]!.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 1, program: ordinary() };
  const game = new GameSession(f.field, f.battle, 314), flow = new GameFlow(game);
  game.field.eventState.write(flag, 0); game.field.eventState.write(global, 0);
  game.field.eventState.beginScript({ labels: ["Existing"], values: [88] });
  const frame = game.field.eventState.captureScriptLocals();
  const before = game.state.snapshot();
  flow.start(); flow.advance(0, walkHost); assert.equal(flow.move("right"), true); flow.advance(240, walkHost);
  flow.advance(10, walkHost); assert.equal(game.field.eventState.read(flag), 0);
  assert.equal(flow.requestEscape(), true); flow.advance(10, walkHost); assert.equal(flow.phase, "escaped");
  assert.equal(flow.continueEscape(), true); assert.equal(game.field.eventState.read(flag), 1);
  assert.equal(game.field.eventState.read(global), 7); game.field.eventState.restoreScriptLocals(frame);
  assert.deepEqual(game.field.eventState.snapshot().script, [88]);
  assert.equal(game.gil, before.gil); assert.deepEqual(game.completedEncounters, []);
  assert.equal(game.state.snapshot().completedBattles[0]!.outcome, "escaped");
  const saved = game.checkpoint(), restored = GameSession.restore(saved, f.field, f.battle);
  assert.deepEqual(restored.checkpoint(), saved);
});
