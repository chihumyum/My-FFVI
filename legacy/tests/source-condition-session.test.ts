import test from "node:test";
import assert from "node:assert/strict";
import { sourceConditionSessionFixture } from "./fixtures/source-condition-session.js";
import { encounterReady } from "./fixtures/source-encounter-session.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { CheckpointStorage } from "../src/core/saved-game.js";

const host = { prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {} };
function begin(f: ReturnType<typeof sourceConditionSessionFixture>) {
  const live = f.make(); assert.equal(live.game.field.startEvent("source-fight"), true);
  for (let i = 0; i < 100 && !live.game.field.stop; i++) live.flow.advance(10, encounterReady);
  assert.equal(live.game.field.stop?.kind, "encounter", live.game.field.stop?.message);
  return live;
}
function fight(live: ReturnType<typeof begin>) {
  const battle = live.game.battle!;
  for (let i = 0; i < 5000 && battle.phase === "active"; i++) {
    for (const player of battle.ready) {
      const target = battle.enemies.find(enemy => enemy.hp > 0); if (!target) break;
      live.commands.command(battle, player.id, 10, { kind: "single", id: target.id }, 100);
    }
    live.flow.advance(10, encounterReady);
  }
  assert.equal(battle.phase, "victory"); return battle;
}

test("all four control states share the prepared Session battle, cleanup, native return and storage continuation", async () => {
  for (const conditionId of [7, 12, 70, 14] as const) {
    const f = sourceConditionSessionFixture(conditionId), live = begin(f), { game, flow } = live,
      handoff = new GameBattleHandoff(flow, host), field = game.field, player = field.player,
      entity = player.native!.entity, before = game.state.snapshot();
    assert.equal((await handoff.start()).status, "committed");
    const battle = game.battle!;
    for (let index = 0; index < 5000 && !battle.players.some(unit => unit.conditionIds.includes(conditionId)); index++)
      flow.advance(10, encounterReady);
    const affected = battle.players.find(unit => unit.conditionIds.includes(conditionId));
    assert.ok(affected, "the actual enemy must apply the declared condition: " + conditionId);
    assert.equal(game.checkpointReady, false); assert.throws(() => game.checkpoint());
    assert.deepEqual(game.state.snapshot(), before, "the owned lease stays frozen during battle");
    const clocks = battle.controlClockState(affected.id);
    assert.equal(flow.pause(true), true); flow.advance(1000, encounterReady);
    assert.deepEqual(battle.controlClockState(affected.id), clocks); assert.equal(flow.pause(false), true);
    if (conditionId === 7) {
      for (let index = 0; index < 1000 && affected.conditionIds.includes(7); index++) flow.advance(10, encounterReady);
      assert.equal(affected.conditionIds.includes(7), false);
    } else if (conditionId === 14) {
      for (let index = 0; index < 2000 && affected.hp > 0; index++) flow.advance(10, encounterReady);
      assert.equal(affected.hp, 0, "countdown settlement uses the real HP/condition owner");
    }
    fight(live);
    assert.equal((await handoff.return()).status, "committed");
    for (let i = 0; i < 100 && !game.checkpointReady; i++) flow.advance(10, encounterReady);
    assert.equal(game.checkpointReady, true, field.stop?.message);
    assert.strictEqual(game.field, field); assert.strictEqual(field.player, player); assert.strictEqual(player.native!.entity, entity);
    assert.equal(game.state.completedEncounters.length, 1);
    assert.equal(game.players.some(unit => unit.conditionIds.includes(conditionId)), false);
    await assert.rejects(() => handoff.return(), /requires/);
    const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
      setItem: (key, value) => { bytes.set(key, value); } }, "framework", "control-session-" + conditionId);
    await storage.save(game.checkpoint(), 1000); const saved = (await storage.load())!;
    const restored = f.restore(saved.checkpoint), restoredFlow = new GameFlow(restored);
    restoredFlow.start(); restoredFlow.advance(0, encounterReady);
    assert.deepEqual(restored.checkpoint(), saved.checkpoint);
    const commands = new GameCommands(restoredFlow, restored);
    assert.equal(restored.field.startEvent("source-next"), true);
    const next = new GameBattleHandoff(restoredFlow, host); assert.equal((await next.start()).status, "committed");
    assert.equal(live.commands.command(battle, affected.id, 10, "retired", 100), false);
    fight({ game: restored, flow: restoredFlow, commands });
    assert.equal((await next.return()).status, "committed"); restoredFlow.advance(100, encounterReady);
    assert.equal(restored.state.completedEncounters.length, 2); assert.equal(restored.checkpointReady, true);
  }
});

test("a real countdown defeat retries the frozen entry and a later victory settles resources once", async () => {
  const f = sourceConditionSessionFixture(14), live = begin(f), handoff = new GameBattleHandoff(live.flow, host),
    before = live.game.state.snapshot(), request = structuredClone(live.game.field.stop);
  assert.equal((await handoff.start()).status, "committed"); const defeated = live.game.battle!;
  for (let index = 0; index < 10000 && defeated.phase === "active"; index++) live.flow.advance(10, encounterReady);
  assert.equal(defeated.phase, "defeat"); assert.equal(live.game.state.completedEncounters.length, 0);
  assert.deepEqual(live.game.state.snapshot(), before);
  assert.equal((await handoff.retry()).status, "committed");
  assert.notStrictEqual(live.game.battle, defeated); assert.deepEqual(live.game.field.stop, request);
  fight(live); assert.equal((await handoff.return()).status, "committed"); live.flow.advance(100, encounterReady);
  assert.equal(live.game.state.completedEncounters.length, 1);
  await assert.rejects(() => handoff.return(), /requires/);
});
