import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { GameSession } from "../src/core/game-session.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { participantFixture, participantSessionFixture } from "./fixtures/battle-participant-game.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

function snapshot(b: BattleGame) {
  return { units: structuredClone(b.combatants), participants: b.participantExecution, event: b.eventExecution,
    action: structuredClone(b.action), pending: b.pendingActions, time: b.time, phase: b.phase,
    ai: b.enemies.map(unit => b.enemyAIState(unit.id)), events: structuredClone(b.events), reward: b.reward };
}
function win(game: GameSession) {
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

test("replacements preserve raw slots but get new instance IDs, AI owners and complete history", () => {
  const b = new BattleGame(participantFixture([
    { kind: "add-enemy", monsterId: 341, uniqueId: 2 },
    { kind: "add-enemy", monsterId: 342, uniqueId: 2 },
    { kind: "add-enemy", monsterId: 72, uniqueId: 9 },
  ]), 29);
  const old = b.enemies[0]!, collection = b.combatants;
  b.advance(10);
  const first = b.enemies.find(unit => unit.sourceId === 341)!;
  assert.equal(first.id, "enemy:dynamic:1"); assert.equal(first.hp, first.maxHp);
  assert.equal(b.enemyAIState(old.id), null); assert.ok(b.enemyAIState(first.id));
  assert.equal(b.eventExecution.controls.enemyNoAct, true);
  b.advance(10);
  const second = b.enemies.find(unit => unit.sourceId === 342)!;
  assert.equal(second.id, "enemy:dynamic:2"); assert.equal(b.enemyAIState(first.id), null);
  b.advance(10); b.advance(10);
  assert.equal(b.combatants, collection);
  assert.deepEqual(b.enemies.map(unit => unit.id), ["e2", "enemy:dynamic:2", "enemy:dynamic:3"]);
  assert.equal(b.eventExecution.controls.enemyNoAct, false);
  assert.deepEqual(b.participantExecution.entries.map(({ id, uniqueId, removed }) => [id, uniqueId, removed]),
    [["e1", 2, true], ["e2", 8, false], [first.id, 2, true], [second.id, 2, false], ["enemy:dynamic:3", 9, false]]);
  assert.equal(b.command("a", 10, old.id), false);
});

test("a retired actor's queued action is removed and its running target presentation is cancelled", () => {
  const c = participantFixture([{ kind: "wait", seconds: 0.04 }, { kind: "add-enemy", monsterId: 341, uniqueId: 2 }]);
  c.initialAtb.enemy = [100, 100];
  const b = new BattleGame(c, 33);
  assert.equal(b.command("a", 10, "e1"), true);
  assert.equal(b.command("b", 10, "e1"), true);
  b.advance(10); assert.equal(b.action!.actor, "a");
  assert.ok(b.pendingActions.some(action => action.actor === "e1"));
  b.advance(40);
  assert.equal(b.enemyAIState("e1"), null);
  assert.ok(b.pendingActions.every(action => action.actor !== "e1"));
  assert.ok(!b.action?.targetIds.includes("e1"));
  b.advance(1500);
  assert.equal(b.enemies.find(unit => unit.sourceId === 341)!.hp, 10,
    "A queued single target cannot alias the replacement merely because its slot matches");
});

test("SleepEnemy gates fresh enemy decisions while ATB, player actions and the event clock continue", () => {
  const c = participantFixture([{ kind: "enemy-no-act", enabled: true }, { kind: "wait", seconds: 0.04 },
    { kind: "enemy-no-act", enabled: false }]);
  const b = new BattleGame(c, 37);
  assert.equal(b.command("a", 10, "e1"), true);
  b.advance(10);
  assert.equal(b.eventExecution.controls.updateEnabled, true);
  assert.equal(b.eventExecution.controls.enemyNoAct, true);
  b.enemies[1]!.atb = 100;
  const atb = b.enemies[0]!.atb;
  b.advance(20);
  assert.ok(b.enemies[0]!.atb > atb);
  assert.ok(b.action!.elapsed > 0);
  assert.equal(b.pendingActions.some(action => action.actor === "e2"), false);
  b.advance(20);
  assert.equal(b.eventExecution.controls.enemyNoAct, false);
  b.advance(10); // The event request follows this host's progress phase.
  assert.ok(b.pendingActions.some(action => action.actor === "e2"));
});

test("late same-clock failure rolls back roster objects, queues, allocator, gate and random stream", () => {
  const c = participantFixture([{ kind: "add-enemy", monsterId: 341, uniqueId: 2 }]);
  const b = new BattleGame(c, 41), control = new BattleGame(structuredClone(c), 41);
  c.initialAtb.enemy = [0, 80]; control.content.initialAtb.enemy = [0, 80];
  const owners = [...b.combatants], before = snapshot(b);
  // Fault injection after roster, AI and random entry state were published.
  // The public observation list is the final side effect of addEnemy.
  Object.defineProperty(b.events, "push", { configurable: true,
    value: () => { throw new Error("Controlled log failure after entry"); } });
  assert.throws(() => b.advance(10), /Controlled log failure/);
  assert.deepEqual(snapshot(b), before);
  assert.ok(b.combatants.every((unit, index) => unit === owners[index]));
  delete (b.events as unknown as { push?: unknown }).push;
  b.advance(0); control.advance(10); // Retry the unconsumed failed frame.
  assert.deepEqual(snapshot(b), snapshot(control));
});

test("invalid future entry dependency rejects the whole encounter before it consumes a session lease", () => {
  const f = participantSessionFixture(); delete f.battle.encounters[1000]!.participants!.enemyDefinitions[72];
  const game = new GameSession(f.field, f.battle, 43), before = game.state.snapshot();
  game.field.startEvent("fight");
  game.advance(10);
  assert.equal(game.field.stop?.kind, "unsupported");
  assert.match((game.field.stop as { message: string }).message, /admitted.*entry/);
  assert.equal(game.battle, null); assert.deepEqual(game.state.snapshot(), before);
});

test("an unsupported reserve AI fails atomically rather than publishing a inert enemy", () => {
  const c = participantFixture();
  c.participants!.enemyDefinitions[341]!.ai = syntheticAI([["NotAnAIInstruction"]]);
  const b = new BattleGame(c, 47), owners = [...b.combatants], before = snapshot(b);
  assert.throws(() => b.advance(10), /AI|Instruction|instruction/);
  assert.deepEqual(snapshot(b), before);
  assert.ok(b.combatants.every((unit, index) => unit === owners[index]));
});

test("all reserve masters use the same row, condition and command checks before any encounter starts", () => {
  for (const change of [
    { row: "back" }, { commands: [999] }, { conditionIds: [999] }, { conditionResistances: { 999: 100 } },
  ]) {
    const c = participantFixture(); Object.assign(c.participants!.enemyDefinitions[341]!, change);
    assert.throws(() => new BattleGame(c, 48), /row|command|condition|Condition/);
  }
});

test("retiring a dead instance preserves its drop registration; the next instance of that master registers independently", () => {
  const c = participantFixture([{ kind: "add-enemy", monsterId: 341, uniqueId: 2 },
    { kind: "wait", seconds: 0.04 }, { kind: "add-enemy", monsterId: 341, uniqueId: 2 }]);
  c.drops = { kind: "battle-drops-v1", weights: [100, 0, 0, 0, 0, 0, 0, 0], contents: [],
    monsters: Object.keys(c.participants!.enemyDefinitions).map(key => ({ id: Number(key), rate: 0,
      slots: Array.from({ length: 8 }, () => ({ contentId: 0, count: 0 })) })) };
  const b = new BattleGame(c, 48);
  b.enemies[0]!.hp = 0; b.enemies[0]!.conditionIds = [305]; b.advance(10);
  assert.deepEqual(b.registeredDropMonsters, [2000]);
  const first = b.enemies.find(unit => unit.sourceId === 341)!;
  first.hp = 0; first.conditionIds = [305];
  for (let n = 0; n < 20 && b.enemies.some(unit => unit.id === first.id); n++) b.advance(10);
  assert.equal(b.enemyAIState(first.id), null);
  assert.deepEqual(b.registeredDropMonsters, [2000, 341]);
  const second = b.enemies.find(unit => unit.sourceId === 341)!;
  assert.notEqual(first.id, second.id);
  second.hp = 0; second.conditionIds = [305]; b.advance(10);
  assert.deepEqual(b.registeredDropMonsters, [2000, 341, 341]);
});

test("explicit reward scope covers retired history while the return and save publish exactly once", () => {
  for (const [scope, exp, gil] of [["active-units", 31, 33], ["all-entered", 40, 40]] as const) {
    const f = participantSessionFixture(undefined, scope), game = new GameSession(f.field, f.battle, 49);
    const before = game.state.snapshot(); game.field.startEvent("fight"); game.advance(50);
    win(game);
    assert.equal(game.battle!.reward!.exp, exp); assert.equal(game.battle!.reward!.gil, gil);
    assert.deepEqual(game.state.snapshot(), before);
    assert.equal(game.continueVictory(), true); assert.equal(game.continueVictory(), false);
    game.advance(10); const checkpoint = JSON.parse(JSON.stringify(game.checkpoint()));
    const restored = GameSession.restore(checkpoint, f.field, f.battle);
    assert.deepEqual(restored.checkpoint(), game.checkpoint());
    restored.field.startEvent("fight"); restored.advance(50); win(restored);
    assert.equal(restored.continueVictory(), true); restored.advance(10);
    assert.equal(restored.state.snapshot().completedBattles.length, 2);
    assert.equal(restored.state.snapshot().gil, before.gil + gil * 2);
  }
});

test("defeat retry uses fixed entry masters and initial roster instead of the later mutable catalog", () => {
  const f = participantSessionFixture(), game = new GameSession(f.field, f.battle, 51);
  game.field.startEvent("fight"); game.advance(50);
  const battle = game.battle!, before = game.state.snapshot(), fixed = battle.participantEntryContent;
  for (const unit of battle.players) { unit.hp = 0; unit.conditionIds = [305]; }
  game.advance(10); assert.equal(battle.phase, "defeat");
  battle.content.enemies.splice(0);
  battle.content.participants!.enemyDefinitions[341]!.hp = 9999;
  f.battle.encounters[1000]!.participants!.enemyDefinitions[341]!.name = "later mutable master";
  assert.equal(game.retryBattle(), true);
  assert.deepEqual(game.battle!.participantEntryContent, fixed);
  assert.deepEqual(game.battle!.enemies.map(unit => unit.id), ["e1", "e2"]);
  assert.equal(game.battle!.participantExecution.nextGeneration, 1);
  assert.deepEqual(game.state.snapshot(), before);
  game.advance(50); assert.equal(game.battle!.enemies.find(unit => unit.sourceId === 341)!.maxHp, 10);
});

test("new enemy AI initial variables are its own even when the retired master shares an AI program", () => {
  const c = participantFixture([{ kind: "add-enemy", monsterId: 341, uniqueId: 2 }]);
  c.participants!.enemyDefinitions[341]!.ai = syntheticAI([
    ["VariableAssign", [0, 17]], ["Nop"], ["SyncAI"], ["StartTable", [0]],
    ["Act", [13]], ["EndTable"], ["JumpBattleAI", [1]],
  ]);
  const b = new BattleGame(c, 53); b.enemies[0]!.behavior!.variables[0] = 99;
  b.advance(10); const joined = b.enemies.find(unit => unit.sourceId === 341)!;
  assert.equal(joined.behavior!.variables[0], 17);
  assert.equal(b.enemyAIState("e1"), null); assert.equal(b.enemyAIState(joined.id)!.status, "waiting");
});

test("a static-only retry cannot acquire a participant provider injected after entry", () => {
  const f = checkpointFixture(), game = new GameSession(f.field, f.battle, 57);
  game.field.startEvent("fight"); game.advance(10);
  for (const unit of game.battle!.players) { unit.hp = 0; unit.conditionIds = [305]; }
  game.advance(10); assert.equal(game.battle!.phase, "defeat");
  game.battle!.content.participants = participantFixture().participants!;
  assert.equal(game.retryBattle(), true);
  assert.equal(game.battle!.content.participants, undefined);
  assert.deepEqual(game.battle!.enemies.map(unit => unit.id), ["e1", "e2"]);
});
